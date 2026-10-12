const select = document.getElementById("category-select");
const title = document.getElementById("history-title");
const message = document.getElementById("history-message");
const chartContainer = document.getElementById("chart-container");
const totalsContainer = document.getElementById("totals-container");
const totalsBody = document.getElementById("history-totals");

let chart = null;
let requestVersion = 0;

async function getJson(path) {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    cache: "no-store"
  });

  if (response.status === 401) {
    window.location.assign("/login");
    throw new Error("Please sign in.");
  }

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}).`);
  }

  return response.json();
}

function formatMonth(value) {
  const [year, month] = value.split("-").map(Number);

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "numeric"
  }).format(new Date(year, month - 1, 1));
}

function clearResults() {
  if (chart) {
    chart.destroy();
    chart = null;
  }

  chartContainer.hidden = true;
  totalsContainer.hidden = true;
  totalsBody.replaceChildren();
}

async function loadHistory() {
  const version = ++requestVersion;
  const category = select.value;

  clearResults();

  if (!category) {
    title.textContent = "Select a category";
    message.textContent = "Choose a category to view its history.";
    return;
  }

  title.textContent = `Spending history: ${category}`;
  message.textContent = "Loading…";

  try {
    const params = new URLSearchParams({
      category,
      months: "6"
    });

    const data = await getJson(`/spending-history?${params}`);

    if (version !== requestVersion) {
      return;
    }

    if (data.history.length === 0) {
      message.textContent =
        "No spending history for this category in the previous six completed months.";
      return;
    }

    const amounts = data.history.map(item => Number(item.amount));

    if (amounts.some(amount => !Number.isFinite(amount))) {
      throw new Error("The server returned an invalid amount.");
    }

    message.textContent = "";
    chartContainer.hidden = false;
    totalsContainer.hidden = false;

    chart = new Chart(document.getElementById("history-chart"), {
      type: "bar",
      data: {
        labels: data.history.map(item => formatMonth(item.month)),
        datasets: [{
          label: `${category} spending`,
          data: amounts,
          backgroundColor: "#198754"
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            title: { display: true, text: "Month" }
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: "Amount" }
          }
        }
      }
    });

    for (const item of data.history) {
      const row = document.createElement("tr");
      const monthCell = document.createElement("td");
      const amountCell = document.createElement("td");

      monthCell.textContent = formatMonth(item.month);
      amountCell.textContent = item.amount;

      row.append(monthCell, amountCell);
      totalsBody.append(row);
    }
  } catch (error) {
    if (version === requestVersion) {
      clearResults();
      message.textContent = error.message;
    }
  }
}

async function initialize() {
  try {
    const categories = await getJson("/categories");


    select.replaceChildren(new Option("Select a category", ""));

    for (const category of categories) {
      select.add(new Option(category, category));
    }

    if (categories.length === 0) {
      message.textContent = "No categories are available.";
      return;
    }

    select.disabled = false;

    const requested = new URLSearchParams(
      window.location.search
    ).get("category");

    select.value = categories.includes(requested)
      ? requested
      : categories[0];

    await loadHistory();
  } catch (error) {
    select.replaceChildren(
      new Option("Unable to load categories", "")
    );
    message.textContent = error.message;
  }
}

select.addEventListener("change", loadHistory);

window.addEventListener("pageshow", event => {
  if (event.persisted && !select.disabled) {
    loadHistory();
  }
});

async function startPage() {
  await i18n.init();
  await initialize();
}

startPage();
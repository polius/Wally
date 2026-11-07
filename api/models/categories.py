from typing import Annotated
from pydantic import StringConstraints
from sqlmodel import SQLModel, Field

# The categories a new household starts with, in each of the app's languages. Same order in each:
# entertainment, food (eating out), groceries, healthcare, income, miscellaneous, rent, shopping,
# travel, utilities. The app picks each one's icon from its name (catIcon in web/js/core.js), and
# tells income from expenses by it until there are transactions, so every name here has to read as
# its icon there: tests/test_api.py checks it.
DEFAULT_NAMES = {
    "en": ["Entertainment", "Food", "Groceries", "Healthcare", "Income", "Miscellaneous", "Rent", "Shopping", "Travel", "Utilities"],
    "es": ["Ocio", "Comida", "Supermercado", "Salud", "Ingresos", "Varios", "Alquiler", "Compras", "Viajes", "Suministros"],
    "ca": ["Oci", "Menjar", "Supermercat", "Salut", "Ingressos", "Varis", "Lloguer", "Compres", "Viatges", "Subministraments"],
    "fr": ["Loisirs", "Restaurants", "Courses", "Santé", "Revenus", "Divers", "Loyer", "Achats", "Voyages", "Factures"],
    "de": ["Freizeit", "Essen", "Lebensmittel", "Gesundheit", "Einnahmen", "Sonstiges", "Miete", "Einkäufe", "Reisen", "Nebenkosten"],
    "it": ["Svago", "Ristoranti", "Spesa", "Salute", "Entrate", "Varie", "Affitto", "Acquisti", "Viaggi", "Bollette"],
    "pt": ["Lazer", "Restaurantes", "Supermercado", "Saúde", "Receitas", "Diversos", "Aluguel", "Compras", "Viagens", "Contas"],
    "ru": ["Развлечения", "Еда", "Продукты", "Здоровье", "Доход", "Разное", "Аренда", "Покупки", "Путешествия", "Коммунальные услуги"],
    "zh": ["娱乐", "餐饮", "食品杂货", "医疗", "收入", "其他", "房租", "购物", "旅行", "水电费"],
    "ja": ["娯楽", "外食", "食料品", "医療", "収入", "その他", "家賃", "買い物", "旅行", "光熱費"],
    "ko": ["오락", "외식", "식료품", "의료", "수입", "기타", "월세", "쇼핑", "여행", "공과금"],
    "hi": ["मनोरंजन", "भोजन", "किराना", "स्वास्थ्य", "आय", "विविध", "किराया", "खरीदारी", "यात्रा", "बिल"],
    "ar": ["ترفيه", "طعام", "بقالة", "صحة", "الدخل", "متفرقات", "إيجار", "تسوق", "سفر", "فواتير"],
}
# The icon each of those names stands for, in the same order
DEFAULT_ICONS = ["entertainment", "food", "groceries", "healthcare", "income", "misc", "rent", "shopping", "travel", "utilities"]

def default_categories(language: str) -> list[dict]:
    """The starting categories in a language, English for one the app doesn't have."""
    return [{"name": n} for n in DEFAULT_NAMES.get(language, DEFAULT_NAMES["en"])]

# A category's color isn't stored: the app gives it from the category's place in all-time spending
# (biggest red, then on through the rainbow). Income is always green.

class CategoryBase(SQLModel):
    name: str = Field(primary_key=True)

class Category(CategoryBase, table=True):
    pass

class CategoryColor(SQLModel, table=True):
    """Colors picked before they followed spending. No longer read or written; the table stays so
    backups and older households keep the same tables."""
    name: str = Field(primary_key=True)
    color: int

class CategoryIcon(SQLModel, table=True):
    """The icon someone picked. Without one, the app picks it from the name."""
    name: str = Field(primary_key=True)
    icon: str

# An icon's id: one of the app's own, or "l-" and the name of one of Lucide's. "" goes back to the one
# picked from the name.
IconId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{0,64}$")]

class CategoryCreate(CategoryBase):
    icon: IconId | None = None

class CategoryUpdate(SQLModel):
    name: str | None = None
    icon: IconId | None = None

class CategoryPublic(CategoryBase):
    icon: str | None = None

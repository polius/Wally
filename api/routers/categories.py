from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated
from sqlmodel import Session, select, func
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

from ..database import get_session
from ..models.categories import Category, CategoryColor, CategoryIcon, CategoryCreate, CategoryPublic, CategoryUpdate, COLORS, GREY
from ..models.transactions import Transaction
from ..models.recurring_transactions import RecurringTransaction
from ..models.money import ImportRule
from .auth import check_login

router = APIRouter(tags=["Categories"], dependencies=[Depends(check_login)])

@router.get("/categories", response_model=list[str])
def read_categories(
    db: Annotated[Session, Depends(get_session)]
):
    statement = select(Category).order_by(Category.name)
    categories = db.exec(statement).all()
    return sorted([c.name for c in categories], key=str.lower)

def assign_colors(db: Session) -> dict[str, int | None]:
    """Every category's color. One without a color takes the first one nobody has, biggest spender
    first, or grey once all eight are taken, and keeps it from then on. Income categories (income
    and no spending) have none."""
    names = [c.name for c in db.exec(select(Category)).all()]
    colors = {c.name: c.color for c in db.exec(select(CategoryColor)).all()}
    spent = dict(db.exec(select(Transaction.category, func.sum(Transaction.amount)).where(Transaction.type == "expense").group_by(Transaction.category)).all())
    earned = set(db.exec(select(Transaction.category).where(Transaction.type == "income").distinct()).all())
    income = {n for n in names if n in earned and n not in spent}
    used = {k: 0 for k in COLORS}
    for n in names:
        if colors.get(n) in used:
            used[colors[n]] += 1
    missing = sorted((n for n in names if n not in colors and n not in income), key=lambda n: (-float(spent.get(n) or 0), n.lower()))
    for n in missing:
        free = [k for k in COLORS if not used[k]]
        colors[n] = free[0] if free else GREY
        if colors[n] in used:
            used[colors[n]] += 1
        db.add(CategoryColor(name=n, color=colors[n]))
    if missing:
        db.commit()
    return {n: (None if n in income else colors.get(n)) for n in names}

def set_color(db: Session, name: str, color: int):
    row = db.get(CategoryColor, name)
    if row:
        row.color = color
    else:
        row = CategoryColor(name=name, color=color)
    db.add(row)

def set_icon(db: Session, name: str, icon: str):
    row = db.get(CategoryIcon, name)
    if not icon:
        if row:
            db.delete(row)
        return
    if row:
        row.icon = icon
    else:
        row = CategoryIcon(name=name, icon=icon)
    db.add(row)

def public(db: Session, name: str) -> CategoryPublic:
    color, icon = db.get(CategoryColor, name), db.get(CategoryIcon, name)
    return CategoryPublic(name=name, color=color.color if color else None, icon=icon.icon if icon else None)

@router.get("/categories/icons")
def category_icons(
    db: Annotated[Session, Depends(get_session)]
):
    """{name: icon} for the categories whose icon someone picked."""
    return {c.name: c.icon for c in db.exec(select(CategoryIcon)).all()}

@router.get("/categories/colors")
def category_colors(
    db: Annotated[Session, Depends(get_session)]
):
    """{name: color}: 1 to 8, or null for an income category."""
    return assign_colors(db)

@router.get("/categories/stats")
def category_stats(
    db: Annotated[Session, Depends(get_session)]
):
    """Every category with how many transactions use it."""
    counts = dict(db.exec(select(Transaction.category, func.count()).group_by(Transaction.category)).all())
    names = sorted({c.name for c in db.exec(select(Category)).all()}, key=str.lower)
    return [{"name": n, "count": counts.get(n, 0)} for n in names]

@router.post("/categories", response_model=CategoryPublic)
def create_category(
    category: CategoryCreate,
    db: Annotated[Session, Depends(get_session)]
):
    new_category = Category(name=category.name)
    db.add(new_category)
    if category.color is not None:
        set_color(db, category.name, category.color)
    if category.icon:
        set_icon(db, category.name, category.icon)
    try:
        db.commit()
        db.refresh(new_category)
        return public(db, new_category.name)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="This category already exists.")

@router.put("/categories/{category_name}", response_model=CategoryPublic)
def update_category(
    category_name: str,
    category_update: CategoryUpdate,
    db: Annotated[Session, Depends(get_session)]
):
    category = db.get(Category, category_name)
    if not category:
        raise HTTPException(status_code=404, detail="This category does not exist.")
    
    new_category_name = category_update.name if category_update.name is not None else category_name
    if not new_category_name.strip():
        raise HTTPException(status_code=400, detail="A category needs a name.")

    if new_category_name != category_name:
        # Update all transactions that use this category
        statement = select(Transaction).where(Transaction.category == category_name)
        transactions = db.exec(statement).all()
        for transaction in transactions:
            transaction.category = new_category_name
            db.add(transaction)

        # Update all recurring transactions that use this category
        statement = select(RecurringTransaction).where(RecurringTransaction.category == category_name)
        recurring_transactions = db.exec(statement).all()
        for recurring_transaction in recurring_transactions:
            recurring_transaction.category = new_category_name
            db.add(recurring_transaction)

        # Import rules follow the category
        db.exec(update(ImportRule).where(ImportRule.category == category_name).values(category=new_category_name))

    # The color and icon move with the name, then take the new values
    if new_category_name != category_name:
        if db.get(Category, new_category_name):
            raise HTTPException(status_code=400, detail="A category with this name already exists.")
        old_color = db.get(CategoryColor, category_name)
        if old_color:
            color = old_color.color
            db.delete(old_color)
            db.flush()
            db.add(CategoryColor(name=new_category_name, color=color))
        old_icon = db.get(CategoryIcon, category_name)
        if old_icon:
            icon = old_icon.icon
            db.delete(old_icon)
            db.flush()
            db.add(CategoryIcon(name=new_category_name, icon=icon))
        category.name = new_category_name
    if category_update.color is not None:
        set_color(db, new_category_name, category_update.color)
    if category_update.icon is not None:
        set_icon(db, new_category_name, category_update.icon)

    try:
        db.add(category)
        db.commit()
        db.refresh(category)
        return public(db, category.name)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="A category with this name already exists.")

@router.get("/categories/{category_name}/usage")
def category_usage(
    category_name: str,
    db: Annotated[Session, Depends(get_session)]
):
    """How many transactions and rules use a category, for the delete confirmation."""
    transactions = db.exec(select(func.count()).select_from(Transaction).where(Transaction.category == category_name)).one()
    recurring = db.exec(select(func.count()).select_from(RecurringTransaction).where(RecurringTransaction.category == category_name)).one()
    return {"transactions": transactions, "recurring": recurring}

@router.delete("/categories/{category_name}")
def delete_category(
    category_name: str,
    db: Annotated[Session, Depends(get_session)],
    move_to: str | None = None,
):
    """Delete a category. Transactions and rules using it move to another category first."""
    category = db.get(Category, category_name)
    if not category:
        raise HTTPException(status_code=404, detail="This category does not exist.")

    used = category_usage(category_name, db)
    if used["transactions"] or used["recurring"]:
        if not move_to or move_to == category_name or not db.get(Category, move_to):
            count = used["transactions"]
            raise HTTPException(
                status_code=400,
                detail=f"Cannot delete category. {count} transaction{'s' if count != 1 else ''} {'are' if count != 1 else 'is'} using this category. Choose where to move them."
            )
        db.exec(update(Transaction).where(Transaction.category == category_name).values(category=move_to))
        db.exec(update(RecurringTransaction).where(RecurringTransaction.category == category_name).values(category=move_to))
        db.exec(update(ImportRule).where(ImportRule.category == category_name).values(category=move_to))

    for kept in (db.get(CategoryColor, category_name), db.get(CategoryIcon, category_name)):
        if kept:
            db.delete(kept)
    db.delete(category)
    db.commit()
    return {"ok": True}

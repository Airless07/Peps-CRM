-- Expenses (lab testing first). Additive only: two new tables, nothing existing changes,
-- so every current stock and money total stays exactly the same.
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "category" TEXT NOT NULL,
    "vendor" TEXT NOT NULL DEFAULT '',
    "amountCents" INTEGER NOT NULL,
    "paidBy" TEXT NOT NULL,
    "productIds" TEXT NOT NULL DEFAULT '[]',
    "lots" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "file" TEXT NOT NULL DEFAULT '',
    "fileName" TEXT NOT NULL DEFAULT '',
    "mime" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ExpenseEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expenseId" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT ''
);

CREATE INDEX "ExpenseEvent_expenseId_idx" ON "ExpenseEvent"("expenseId");

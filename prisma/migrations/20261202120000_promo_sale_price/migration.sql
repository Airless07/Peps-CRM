-- Automatic deals: show the sale price on products (percent off, no minimum, no cap). Additive only: one column, on by default.
ALTER TABLE "Promotion" ADD COLUMN "showSalePrice" BOOLEAN NOT NULL DEFAULT true;

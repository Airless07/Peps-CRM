-- Website orders: who received the payment (Settings > Payments), for cash held. Additive only: one nullable column.
ALTER TABLE "Order" ADD COLUMN "paidTo" TEXT;

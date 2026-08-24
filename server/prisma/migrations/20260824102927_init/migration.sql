-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_email_normalized" CHECK ("email" = lower(btrim("email")) AND length("email") > 0),
    CONSTRAINT "users_password_hash_not_empty" CHECK (length("password_hash") > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_unique" ON "users"("email");

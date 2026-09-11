-- AlterTable
ALTER TABLE "conversations"
  ADD COLUMN "pending_actions" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Application-owned pending action state is always a small JSON array.
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_pending_actions_array_check"
  CHECK (
    jsonb_typeof("pending_actions") = 'array'
    AND jsonb_array_length("pending_actions") <= 2
  );

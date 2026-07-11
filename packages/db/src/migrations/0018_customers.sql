CREATE TABLE customers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  email      text,
  phone      text,
  address    text,
  company    text,
  id_number  text,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

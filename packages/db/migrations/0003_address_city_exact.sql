CREATE INDEX IF NOT EXISTS addresses_search_city_exact
  ON reference_cz.addresses (search_city);

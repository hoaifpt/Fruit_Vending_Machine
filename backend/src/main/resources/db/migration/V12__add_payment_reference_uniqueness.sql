-- Webhook handling resolves an attempt by our own reference; reference namespaces are per provider.
-- Creation fails loudly if existing rows already violate it, so no data is rewritten or discarded.
CREATE UNIQUE INDEX uq_payments_provider_reference
    ON payments (provider, payment_reference) WHERE payment_reference IS NOT NULL;

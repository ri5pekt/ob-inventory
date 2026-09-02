Prompt to hand to the agent/developer who owns the "OB Inventory Sync" WooCommerce plugin
(`ob-inventory-sync.php`, currently v1.1.0). Copy everything below the line.

---

I need to add ONE new REST route to the "OB Inventory Sync" plugin so that our OB Inventory app can cancel a WooCommerce order. Today the plugin only supports OB → Woo stock pushes (`PUT /wp-json/ob-inventory/v1/stock`) and read-only product listing (`GET /wp-json/ob-inventory/v1/products`) — there is no way for OB Inventory to change an order's status. We need this because OB Inventory now has a "convert sale to stock transfer" feature: when a Woo-originated sale is converted into an internal stock transfer, the original Woo order must be cancelled so it isn't re-imported or left dangling.

### New route

Add to `includes/class-ob-inventory-rest.php`, in `register_routes()`, alongside the existing `/stock` route:

```php
register_rest_route($ns, '/orders/(?P<id>\d+)/cancel', [
    'methods'             => WP_REST_Server::EDITABLE, // PUT
    'callback'            => [$this, 'cancel_order'],
    'permission_callback' => [$this, 'check_token'],
    'args'                => [
        'id'     => ['required' => true, 'type' => 'integer'],
        'reason' => ['type' => 'string', 'sanitize_callback' => 'sanitize_text_field'],
    ],
]);
```

### Handler

```php
/**
 * PUT /wp-json/ob-inventory/v1/orders/{id}/cancel
 *
 * Called by OB Inventory when a Woo-originated sale is converted to a stock
 * transfer (or otherwise needs to be voided) — cancels the order so it is
 * not re-imported by the sync webhook.
 * Body: { reason?: string }
 */
public function cancel_order(WP_REST_Request $request): WP_REST_Response {
    if (! function_exists('wc_get_order')) {
        return new WP_REST_Response(['error' => 'WooCommerce is not active'], 503);
    }

    $order_id = (int) $request->get_param('id');
    $reason   = (string) ($request->get_param('reason') ?: 'Cancelled via OB Inventory');

    $order = wc_get_order($order_id);
    if (! $order) {
        return new WP_REST_Response(['error' => 'Order not found', 'order_id' => $order_id], 404);
    }

    $previous_status = $order->get_status();

    if ($previous_status === 'cancelled') {
        return new WP_REST_Response([
            'ok'               => true,
            'already'          => true,
            'order_id'         => $order_id,
            'previous_status'  => $previous_status,
            'new_status'       => 'cancelled',
        ], 200);
    }

    $order->update_status('cancelled', $reason);
    $order->add_order_note(
        sprintf(
            /* translators: %s: reason */
            __('OB Inventory: Order cancelled — %s', 'ob-inventory-sync'),
            $reason
        )
    );

    return new WP_REST_Response([
        'ok'              => true,
        'already'         => false,
        'order_id'        => $order_id,
        'previous_status' => $previous_status,
        'new_status'      => 'cancelled',
    ], 200);
}
```

### Auth

Reuse the existing `check_token()` Bearer-token check already used by `/stock` and `/products` — no new settings/secrets needed, same shared secret configured in the plugin's admin screen.

### Notes / things to double check on your end

1. **No conflict with the sync webhook**: `class-ob-inventory-webhooks.php` only listens to `woocommerce_order_status_processing` and `woocommerce_order_status_completed`. Moving an order to `cancelled` does not fire either hook, so this won't cause a resync loop. The existing `_ob_inventory_synced` post-meta idempotency flag is untouched and still protects against re-import if the order is later manually reprocessed.
2. **WooCommerce's own stock restoration on cancel**: WC may restore stock quantities itself when an order is cancelled (depending on `woocommerce_cancel_unpaid_order` / stock settings). This is harmless for us — OB Inventory always pushes the authoritative quantity to `PUT /stock` right after any stock-affecting operation, so any transient WC-side restock gets overwritten with the correct number moments later. No action needed unless you want to suppress it explicitly (optional).
3. Please bump the plugin version (`OB_INVENTORY_VERSION` constant + the `Version:` header comment) to **1.2.0** and note the new endpoint in whatever changelog/readme the plugin has.
4. Let me know once deployed so I can smoke-test `PUT https://<site>/wp-json/ob-inventory/v1/orders/{id}/cancel` with a real Bearer token against a test order.

That's the only change needed — everything else (auth, error format, response shape) matches the existing `/stock` and `/products` routes for consistency.

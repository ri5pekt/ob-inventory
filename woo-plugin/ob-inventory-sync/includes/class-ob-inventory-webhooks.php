<?php
/**
 * WooCommerce event hooks — sends order data to OB Inventory when payment is received.
 *
 * Hook used:  woocommerce_order_status_processing
 *   Fires when an order transitions to "processing" (payment confirmed).
 *   This is the correct place for most payment gateways.
 *   For COD orders that skip "processing", also hooks woocommerce_order_status_completed.
 *
 * @package OB_Inventory_Sync
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OB_Inventory_Webhooks {

    public function __construct() {
        // Payment confirmed — most gateways (card, PayPal, etc.)
        add_action( 'woocommerce_order_status_processing', [ $this, 'on_order_paid' ], 10, 2 );
        // COD / manual orders that go straight to "completed"
        add_action( 'woocommerce_order_status_completed',  [ $this, 'on_order_paid' ], 10, 2 );
    }

    /**
     * Called when an order moves to "processing" or "completed".
     * Sends the full order payload to OB Inventory to create a sale record.
     */
    public function on_order_paid( int $order_id, WC_Order $order ): void {
        $api_url = OB_Inventory_Plugin::api_url();
        $token   = OB_Inventory_Plugin::get_option( OB_INVENTORY_OPTION_TOKEN );

        if ( ! $api_url || ! $token ) {
            // Plugin not configured — nothing to do
            return;
        }

        // Avoid double-sending when an order goes processing → completed
        if ( get_post_meta( $order_id, '_ob_inventory_synced', true ) === '1' ) {
            return;
        }

        $payload  = $this->build_payload( $order );
        $endpoint = $api_url . '/webhooks/woo/order';

        $response = wp_remote_post( $endpoint, [
            'headers' => [
                'Content-Type'  => 'application/json',
                'Authorization' => 'Bearer ' . $token,
            ],
            'body'    => wp_json_encode( $payload ),
            'timeout' => 15,
        ] );

        if ( is_wp_error( $response ) ) {
            $order->add_order_note(
                sprintf(
                    /* translators: %s: error message */
                    __( 'OB Inventory: Failed to sync order — %s', 'ob-inventory-sync' ),
                    $response->get_error_message()
                )
            );
            return;
        }

        $code = wp_remote_retrieve_response_code( $response );
        $body = json_decode( wp_remote_retrieve_body( $response ), true );

        if ( $code === 200 || $code === 201 ) {
            // 200 = already processed (idempotent), 201 = newly created
            update_post_meta( $order_id, '_ob_inventory_synced', '1' );

            $sale_id = $body['saleId'] ?? null;
            $unresolved = $body['unresolvedSkus'] ?? [];

            $note = $sale_id
                ? sprintf( __( 'OB Inventory: Order synced. Sale ID: %s', 'ob-inventory-sync' ), $sale_id )
                : __( 'OB Inventory: Order already processed.', 'ob-inventory-sync' );

            if ( ! empty( $unresolved ) ) {
                $note .= ' ' . sprintf(
                    /* translators: %s: comma-separated SKU list */
                    __( 'Unresolved SKUs (not in OB Inventory): %s', 'ob-inventory-sync' ),
                    implode( ', ', $unresolved )
                );
            }

            $order->add_order_note( $note );
        } else {
            $error = $body['error'] ?? ( 'HTTP ' . $code );
            $order->add_order_note(
                sprintf(
                    /* translators: %s: error message */
                    __( 'OB Inventory: Sync failed — %s', 'ob-inventory-sync' ),
                    $error
                )
            );
        }
    }

    // ── Payload builder ───────────────────────────────────────────────────────

    private function build_payload( WC_Order $order ): array {
        $items = [];

        foreach ( $order->get_items() as $item ) {
            /** @var WC_Order_Item_Product $item */
            $product = $item->get_product();
            $sku     = $product ? $product->get_sku() : '';

            if ( ! $sku ) {
                continue; // Skip items without SKU — can't match in OB Inventory
            }

            $items[] = [
                'woo_product_id'   => $item->get_product_id(),
                'woo_variation_id' => $item->get_variation_id() ?: null,
                'sku'              => $sku,
                'name'             => $item->get_name(),
                'quantity'         => $item->get_quantity(),
                'price_each'       => $product ? (float) $order->get_item_subtotal( $item, false ) : null,
                'line_total'       => (float) $item->get_total(),
            ];
        }

        // Compose a single address string from billing fields
        $address_parts = array_filter( [
            $order->get_billing_address_1(),
            $order->get_billing_address_2(),
            $order->get_billing_city(),
            $order->get_billing_state(),
            $order->get_billing_postcode(),
            $order->get_billing_country(),
        ] );
        $address = implode( ', ', $address_parts );

        return [
            'woo_order_id' => $order->get_id(),
            'status'       => $order->get_status(),
            'customer'     => [
                'name'    => $order->get_formatted_billing_full_name(),
                'email'   => $order->get_billing_email(),
                'phone'   => $order->get_billing_phone(),
                'address' => $address,
            ],
            'total'    => (float) $order->get_total(),
            'currency' => $order->get_currency(),
            'items'    => $items,
        ];
    }
}

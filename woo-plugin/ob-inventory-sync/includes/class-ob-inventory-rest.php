<?php
/**
 * REST API endpoints exposed by the plugin on the WordPress/WooCommerce site.
 *
 * Routes registered:
 *   GET  /wp-json/ob-inventory/v1/ping       — connection test
 *   GET  /wp-json/ob-inventory/v1/products   — flat list of SKU-bearing products
 *
 * All routes require Bearer-token authentication via ob_inventory_check_token().
 *
 * @package OB_Inventory_Sync
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OB_Inventory_REST {

    public function __construct() {
        add_action( 'rest_api_init', [ $this, 'register_routes' ] );
    }

    public function register_routes(): void {
        $ns = 'ob-inventory/v1';

        register_rest_route( $ns, '/ping', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [ $this, 'ping' ],
            'permission_callback' => [ $this, 'check_token' ],
        ] );

        register_rest_route( $ns, '/ping-back', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [ $this, 'ping_back' ],
            'permission_callback' => [ $this, 'check_token' ],
        ] );

        register_rest_route( $ns, '/products', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [ $this, 'get_products' ],
            'permission_callback' => [ $this, 'check_token' ],
            'args'                => [
                'page'     => [ 'type' => 'integer', 'default' => 1,   'minimum' => 1 ],
                'per_page' => [ 'type' => 'integer', 'default' => 100, 'minimum' => 1, 'maximum' => 500 ],
            ],
        ] );
    }

    // ── Auth ──────────────────────────────────────────────────────────────────

    public function check_token( WP_REST_Request $request ): bool|WP_Error {
        $stored = OB_Inventory_Plugin::get_option( OB_INVENTORY_OPTION_TOKEN );

        if ( empty( $stored ) ) {
            return new WP_Error( 'ob_no_token', 'Secret token is not configured on this site.', [ 'status' => 503 ] );
        }

        $header = $request->get_header( 'Authorization' );
        if ( ! $header || ! str_starts_with( $header, 'Bearer ' ) ) {
            return new WP_Error( 'ob_missing_token', 'Authorization header missing or malformed.', [ 'status' => 401 ] );
        }

        if ( ! hash_equals( $stored, substr( $header, 7 ) ) ) {
            return new WP_Error( 'ob_invalid_token', 'Invalid secret token.', [ 'status' => 403 ] );
        }

        return true;
    }

    // ── Handlers ──────────────────────────────────────────────────────────────

    public function ping(): WP_REST_Response {
        return new WP_REST_Response( [
            'status'     => 'ok',
            'plugin'     => 'OB Inventory Sync',
            'version'    => OB_INVENTORY_VERSION,
            'site'       => get_bloginfo( 'name' ),
            'site_url'   => get_site_url(),
            'wc_version' => defined( 'WC_VERSION' ) ? WC_VERSION : null,
            'wp_version' => get_bloginfo( 'version' ),
            'timestamp'  => current_time( 'c' ),
        ], 200 );
    }

    /**
     * GET /wp-json/ob-inventory/v1/ping-back
     *
     * Called by OB Inventory to verify the WooCommerce → Inventory direction.
     * WordPress makes a server-side HTTP request to the configured OB Inventory
     * /api/health endpoint and returns whether it succeeded.
     */
    public function ping_back(): WP_REST_Response {
        $ob_url = OB_Inventory_Plugin::api_url();

        if ( ! $ob_url ) {
            return new WP_REST_Response( [
                'status' => 'error',
                'error'  => 'OB Inventory URL is not configured in the plugin settings.',
            ], 200 );
        }

        $response = wp_remote_get( $ob_url . '/health', [
            'timeout' => 8,
            'headers' => [ 'Accept' => 'application/json' ],
        ] );

        if ( is_wp_error( $response ) ) {
            return new WP_REST_Response( [
                'status'  => 'error',
                'error'   => $response->get_error_message(),
                'ob_url'  => $ob_url,
            ], 200 );
        }

        $code = (int) wp_remote_retrieve_response_code( $response );
        $body = json_decode( wp_remote_retrieve_body( $response ), true );

        $ok = $code === 200 && isset( $body['status'] ) && $body['status'] === 'ok';

        return new WP_REST_Response( [
            'status'      => $ok ? 'ok' : 'error',
            'http_code'   => $code,
            'ob_url'      => $ob_url,
            'ob_db'       => $body['db']    ?? null,
            'ob_redis'    => $body['redis'] ?? null,
            'reached_at'  => current_time( 'c' ),
        ], 200 );
    }

    /**
     * GET /wp-json/ob-inventory/v1/products
     *
     * Returns a flat list of SKU-bearing products/variations:
     *   - Simple products → one entry each.
     *   - Variable products → one entry per variation (flattened).
     *   - Products/variations without a SKU are skipped.
     */
    public function get_products( WP_REST_Request $request ): WP_REST_Response {
        if ( ! function_exists( 'wc_get_products' ) ) {
            return new WP_REST_Response( [ 'error' => 'WooCommerce is not active' ], 503 );
        }

        $page     = (int) $request->get_param( 'page' );
        $per_page = (int) $request->get_param( 'per_page' );

        $total_products = (int) wc_get_products( [
            'status' => 'publish',
            'type'   => [ 'simple', 'variable' ],
            'return' => 'ids',
            'limit'  => -1,
        ] );

        $woo_products = wc_get_products( [
            'status'  => 'publish',
            'type'    => [ 'simple', 'variable' ],
            'limit'   => $per_page,
            'page'    => $page,
            'return'  => 'objects',
            'orderby' => 'ID',
            'order'   => 'ASC',
        ] );

        $items = [];

        foreach ( $woo_products as $product ) {
            if ( $product->is_type( 'variable' ) ) {
                $parent_name  = $product->get_name();
                $parent_id    = $product->get_id();
                $parent_stock = (bool) $product->get_manage_stock();
                $parent_qty   = $parent_stock ? (int) $product->get_stock_quantity() : null;

                foreach ( $product->get_children() as $var_id ) {
                    $var = wc_get_product( $var_id );
                    if ( ! $var ) continue;

                    $sku = $var->get_sku();
                    if ( ! $sku ) continue;

                    $var_manage = $var->get_manage_stock();
                    if ( $var_manage === 'parent' ) {
                        $manages_stock = $parent_stock;
                        $quantity      = $parent_qty;
                    } else {
                        $manages_stock = (bool) $var_manage;
                        $quantity      = $manages_stock ? (int) $var->get_stock_quantity() : null;
                    }

                    $items[] = [
                        'woo_id'       => $var_id,
                        'parent_id'    => $parent_id,
                        'type'         => 'variation',
                        'sku'          => $sku,
                        'name'         => $parent_name,
                        'attrs'        => wc_get_formatted_variation( $var, true, false ) ?: null,
                        'quantity'     => $quantity,
                        'manage_stock' => $manages_stock,
                    ];
                }
            } else {
                $sku = $product->get_sku();
                if ( ! $sku ) continue;

                $manages_stock = (bool) $product->get_manage_stock();
                $quantity      = $manages_stock ? (int) $product->get_stock_quantity() : null;

                $items[] = [
                    'woo_id'       => $product->get_id(),
                    'parent_id'    => null,
                    'type'         => $product->get_type(),
                    'sku'          => $sku,
                    'name'         => $product->get_name(),
                    'attrs'        => null,
                    'quantity'     => $quantity,
                    'manage_stock' => $manages_stock,
                ];
            }
        }

        $total_pages = $per_page > 0 ? (int) ceil( $total_products / $per_page ) : 1;

        $response = new WP_REST_Response( [
            'products'    => $items,
            'count'       => count( $items ),
            'page'        => $page,
            'per_page'    => $per_page,
            'total_pages' => $total_pages,
        ], 200 );

        $response->header( 'X-OB-Total',       $total_products );
        $response->header( 'X-OB-Total-Pages', $total_pages );

        return $response;
    }
}

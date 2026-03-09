<?php
/**
 * Main plugin bootstrap — singleton that loads all sub-components.
 *
 * @package OB_Inventory_Sync
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OB_Inventory_Plugin {

    /** @var OB_Inventory_Plugin|null */
    private static ?OB_Inventory_Plugin $instance = null;

    private OB_Inventory_REST          $rest;
    private OB_Inventory_Admin        $admin;
    private OB_Inventory_Webhooks     $webhooks;
    private OB_Inventory_Product_Meta $product_meta;

    private function __construct() {
        $this->rest         = new OB_Inventory_REST();
        $this->admin        = new OB_Inventory_Admin();
        $this->webhooks     = new OB_Inventory_Webhooks();
        $this->product_meta = new OB_Inventory_Product_Meta();
    }

    public static function instance(): self {
        if ( self::$instance === null ) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Convenience wrapper — reads an option from the WP options table.
     */
    public static function get_option( string $key, string $default = '' ): string {
        return (string) get_option( $key, $default );
    }

    /**
     * Returns the OB Inventory API base URL (always ends with /api, no trailing slash).
     * Usage:  OB_Inventory_Plugin::api_url() . '/webhooks/woo/order'
     */
    public static function api_url(): string {
        $base = rtrim( self::get_option( OB_INVENTORY_OPTION_URL ), '/' );
        return $base ? $base . '/api' : '';
    }
}

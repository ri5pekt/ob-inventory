<?php
/**
 * Plugin Name: OB Inventory Sync
 * Plugin URI:  https://github.com/your-repo/ob-inventory
 * Description: Connects WooCommerce to OB Inventory. Handles real-time stock sync and order events.
 * Version:     1.1.0
 * Author:      OB Inventory
 * License:     GPL-2.0+
 * Text Domain: ob-inventory-sync
 * Requires at least: 6.0
 * Requires PHP: 8.1
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

// ── Constants ─────────────────────────────────────────────────────────────────

define( 'OB_INVENTORY_VERSION',      '1.1.0' );
define( 'OB_INVENTORY_DIR',          plugin_dir_path( __FILE__ ) );
define( 'OB_INVENTORY_OPTION_TOKEN', 'ob_inventory_secret_token' );
define( 'OB_INVENTORY_OPTION_URL',   'ob_inventory_url' );  // Base URL; /api is appended automatically

// ── Load classes ──────────────────────────────────────────────────────────────

require_once OB_INVENTORY_DIR . 'includes/class-ob-inventory-plugin.php';
require_once OB_INVENTORY_DIR . 'includes/class-ob-inventory-rest.php';
require_once OB_INVENTORY_DIR . 'includes/class-ob-inventory-admin.php';
require_once OB_INVENTORY_DIR . 'includes/class-ob-inventory-webhooks.php';
require_once OB_INVENTORY_DIR . 'includes/class-ob-inventory-product-meta.php';

// ── Boot ──────────────────────────────────────────────────────────────────────

OB_Inventory_Plugin::instance();

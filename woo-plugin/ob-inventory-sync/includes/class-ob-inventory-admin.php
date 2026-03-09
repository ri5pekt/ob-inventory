<?php
/**
 * WordPress admin settings page and AJAX handlers.
 *
 * Adds "Settings → OB Inventory" page with:
 *   - Secret Token field
 *   - OB Inventory URL field
 *   - Test Connection button (AJAX → calls /api/health on OB Inventory)
 *
 * @package OB_Inventory_Sync
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OB_Inventory_Admin {

    public function __construct() {
        add_action( 'admin_menu',    [ $this, 'add_menu' ] );
        add_action( 'admin_init',    [ $this, 'register_settings' ] );
        add_action( 'admin_notices', [ $this, 'show_notices' ] );
        add_action( 'admin_enqueue_scripts', [ $this, 'enqueue_scripts' ] );
        add_action( 'wp_ajax_ob_inventory_test_connection', [ $this, 'ajax_test_connection' ] );
    }

    // ── Menu ──────────────────────────────────────────────────────────────────

    public function add_menu(): void {
        add_options_page(
            __( 'OB Inventory Sync', 'ob-inventory-sync' ),
            __( 'OB Inventory', 'ob-inventory-sync' ),
            'manage_options',
            'ob-inventory-sync',
            [ $this, 'render_page' ]
        );
    }

    // ── Settings registration ─────────────────────────────────────────────────

    public function register_settings(): void {
        register_setting( 'ob_inventory_settings', OB_INVENTORY_OPTION_TOKEN, [
            'type'              => 'string',
            'sanitize_callback' => 'sanitize_text_field',
            'default'           => '',
        ] );
        register_setting( 'ob_inventory_settings', OB_INVENTORY_OPTION_URL, [
            'type'              => 'string',
            'sanitize_callback' => 'esc_url_raw',
            'default'           => '',
        ] );

        add_settings_section( 'ob_inventory_auth', __( 'Authentication', 'ob-inventory-sync' ), '__return_false', 'ob-inventory-sync' );

        add_settings_field( OB_INVENTORY_OPTION_TOKEN, __( 'Secret Token', 'ob-inventory-sync' ), [ $this, 'field_token' ], 'ob-inventory-sync', 'ob_inventory_auth' );
        add_settings_field( OB_INVENTORY_OPTION_URL,   __( 'OB Inventory URL', 'ob-inventory-sync' ), [ $this, 'field_url' ],   'ob-inventory-sync', 'ob_inventory_auth' );
    }

    public function field_token(): void {
        $value = OB_Inventory_Plugin::get_option( OB_INVENTORY_OPTION_TOKEN );
        printf(
            '<input type="password" name="%s" value="%s" class="regular-text" autocomplete="new-password" placeholder="%s" />
             <p class="description">%s</p>',
            esc_attr( OB_INVENTORY_OPTION_TOKEN ),
            esc_attr( $value ),
            esc_attr__( 'Enter a strong random token', 'ob-inventory-sync' ),
            esc_html__( 'Shared secret for all communication between this plugin and OB Inventory. Must match the value in OB Inventory → Settings → WooCommerce.', 'ob-inventory-sync' )
        );
    }

    public function field_url(): void {
        $value = OB_Inventory_Plugin::get_option( OB_INVENTORY_OPTION_URL );
        printf(
            '<input type="url" name="%s" value="%s" class="regular-text" placeholder="https://xxxx.ngrok-free.app" />
             <p class="description">%s</p>',
            esc_attr( OB_INVENTORY_OPTION_URL ),
            esc_attr( $value ),
            esc_html__( 'Base URL of your OB Inventory system — no trailing slash. /api is appended automatically. Example: https://xxxx.ngrok-free.app', 'ob-inventory-sync' )
        );
    }

    // ── Admin scripts (inline JS for test button) ─────────────────────────────

    public function enqueue_scripts( string $hook ): void {
        if ( $hook !== 'settings_page_ob-inventory-sync' ) return;
        wp_add_inline_script( 'jquery', $this->test_button_js() );
    }

    private function test_button_js(): string {
        $nonce = wp_create_nonce( 'ob_inventory_test_connection' );
        return <<<JS
jQuery(function($) {
    $('#ob-test-btn').on('click', function(e) {
        e.preventDefault();
        var \$btn    = $(this);
        var \$result = $('#ob-test-result');
        \$btn.prop('disabled', true).text('Testing…');
        \$result.hide().removeClass('notice-success notice-error');
        $.post(ajaxurl, { action: 'ob_inventory_test_connection', nonce: '{$nonce}' })
        .done(function(res) {
            if (res.success) {
                var d = res.data;
                var info = d.db ? ' — DB: ' + d.db + '  Redis: ' + d.redis : '';
                \$result.addClass('notice-success').html('<p>✅ <strong>Connected!</strong>' + info + '</p>');
            } else {
                \$result.addClass('notice-error').html('<p>❌ <strong>Failed:</strong> ' + res.data + '</p>');
            }
            \$result.show();
        })
        .fail(function(xhr) {
            \$result.addClass('notice-error').html('<p>❌ <strong>Request error</strong> (HTTP ' + xhr.status + ')</p>').show();
        })
        .always(function() { \$btn.prop('disabled', false).text('Test Connection'); });
    });
});
JS;
    }

    // ── AJAX: test connection ─────────────────────────────────────────────────

    public function ajax_test_connection(): void {
        check_ajax_referer( 'ob_inventory_test_connection', 'nonce' );
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_send_json_error( 'Permission denied.' );
        }

        $api_url = OB_Inventory_Plugin::api_url();
        if ( ! $api_url ) {
            wp_send_json_error( 'OB Inventory URL is not configured. Save the settings first.' );
        }

        $response = wp_remote_get( $api_url . '/health', [
            'timeout' => 10,
            'headers' => [ 'Accept' => 'application/json' ],
        ] );

        if ( is_wp_error( $response ) ) {
            wp_send_json_error( $response->get_error_message() );
        }

        $code = wp_remote_retrieve_response_code( $response );
        $body = json_decode( wp_remote_retrieve_body( $response ), true );

        if ( $code === 200 && isset( $body['status'] ) && $body['status'] === 'ok' ) {
            wp_send_json_success( $body );
        } else {
            $msg = isset( $body['status'] ) ? "Status: {$body['status']}" : "HTTP $code";
            wp_send_json_error( $msg );
        }
    }

    // ── Admin notices ─────────────────────────────────────────────────────────

    public function show_notices(): void {
        $screen = get_current_screen();
        if ( ! $screen || $screen->id !== 'settings_page_ob-inventory-sync' ) return;

        if ( empty( OB_Inventory_Plugin::get_option( OB_INVENTORY_OPTION_TOKEN ) ) ) {
            echo '<div class="notice notice-warning"><p>'
               . esc_html__( 'OB Inventory Sync: Please set a Secret Token to enable authentication.', 'ob-inventory-sync' )
               . '</p></div>';
        }
        if ( empty( OB_Inventory_Plugin::get_option( OB_INVENTORY_OPTION_URL ) ) ) {
            echo '<div class="notice notice-info"><p>'
               . esc_html__( 'OB Inventory Sync: Set the OB Inventory URL so this plugin can send order events.', 'ob-inventory-sync' )
               . '</p></div>';
        }
    }

    // ── Settings page render ──────────────────────────────────────────────────

    public function render_page(): void {
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_die( esc_html__( 'You do not have permission to access this page.', 'ob-inventory-sync' ) );
        }

        $ping_url     = get_rest_url( null, 'ob-inventory/v1/ping' );
        $products_url = get_rest_url( null, 'ob-inventory/v1/products' );
        ?>
        <div class="wrap">
            <h1><?php esc_html_e( 'OB Inventory Sync', 'ob-inventory-sync' ); ?></h1>
            <p><?php esc_html_e( 'Configure the connection between this WooCommerce store and your OB Inventory system.', 'ob-inventory-sync' ); ?></p>

            <form method="post" action="options.php">
                <?php
                    settings_fields( 'ob_inventory_settings' );
                    do_settings_sections( 'ob-inventory-sync' );
                    submit_button();
                ?>
            </form>

            <hr />
            <h2><?php esc_html_e( 'Test Connection', 'ob-inventory-sync' ); ?></h2>
            <p><?php esc_html_e( 'Save your settings first, then click the button to verify OB Inventory is reachable.', 'ob-inventory-sync' ); ?></p>
            <p>
                <button id="ob-test-btn" class="button button-secondary">
                    <?php esc_html_e( 'Test Connection', 'ob-inventory-sync' ); ?>
                </button>
            </p>
            <div id="ob-test-result" class="notice inline" style="display:none; margin-top:8px;"></div>

            <hr />
            <h2><?php esc_html_e( 'Order Sync', 'ob-inventory-sync' ); ?></h2>
            <p><?php esc_html_e( 'When an order moves to "Processing" status (payment received), this plugin automatically sends the order to OB Inventory and reduces stock from the main warehouse.', 'ob-inventory-sync' ); ?></p>
            <p><?php esc_html_e( 'Products are matched by SKU. Items not found in OB Inventory are recorded in the sale but do not affect stock.', 'ob-inventory-sync' ); ?></p>

            <hr />
            <h2><?php esc_html_e( 'Plugin Endpoints', 'ob-inventory-sync' ); ?></h2>
            <p><?php esc_html_e( 'OB Inventory calls these URLs on this WordPress site:', 'ob-inventory-sync' ); ?></p>
            <table class="form-table">
                <tr>
                    <th><?php esc_html_e( 'Ping / connection test', 'ob-inventory-sync' ); ?></th>
                    <td><code><?php echo esc_html( $ping_url ); ?></code></td>
                </tr>
                <tr>
                    <th><?php esc_html_e( 'Products list', 'ob-inventory-sync' ); ?></th>
                    <td><code><?php echo esc_html( $products_url ); ?></code></td>
                </tr>
                <tr>
                    <th><?php esc_html_e( 'Stock update (OB → Woo)', 'ob-inventory-sync' ); ?></th>
                    <td><code><?php echo esc_html( get_rest_url( null, 'ob-inventory/v1/stock' ) ); ?></code> <small>PUT</small></td>
                </tr>
            </table>
        </div>
        <?php
    }
}

<?php
/**
 * Product edit screen: OB Inventory Sync notes postbox panel.
 *
 * Displays sync history (stock changes) in a meta box on the product edit page.
 *
 * @package OB_Inventory_Sync
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OB_Inventory_Product_Meta {

    public function __construct() {
        add_action( 'add_meta_boxes', [ $this, 'add_meta_box' ] );
        add_action( 'admin_enqueue_scripts', [ $this, 'enqueue_styles' ] );
    }

    public function enqueue_styles( string $hook ): void {
        if ( $hook !== 'post.php' && $hook !== 'post-new.php' ) {
            return;
        }
        $screen = get_current_screen();
        if ( ! $screen || $screen->post_type !== 'product' ) {
            return;
        }
        $url = plugin_dir_url( dirname( __FILE__ ) ) . 'assets/admin-product-meta.css';
        wp_enqueue_style(
            'ob-inventory-product-meta',
            $url,
            [],
            OB_INVENTORY_VERSION
        );
    }

    public function add_meta_box(): void {
        add_meta_box(
            'ob_inventory_sync_notes',
            __( 'OB Inventory Sync', 'ob-inventory-sync' ),
            [ $this, 'render_meta_box' ],
            'product',
            'side',
            'default'
        );
    }

    public function render_meta_box( WP_Post $post ): void {
        $product_id = $post->ID;
        $product    = wc_get_product( $product_id );

        if ( ! $product ) {
            echo '<p>' . esc_html__( 'Product not found.', 'ob-inventory-sync' ) . '</p>';
            return;
        }

        $sku = $product->get_sku();
        if ( ! $sku ) {
            echo '<p>' . esc_html__( 'This product has no SKU. OB Inventory sync matches by SKU.', 'ob-inventory-sync' ) . '</p>';
        } else {
            echo '<p><strong>' . esc_html__( 'SKU:', 'ob-inventory-sync' ) . '</strong> ' . esc_html( $sku ) . '</p>';
        }

        $notes = (array) get_post_meta( $product_id, '_ob_inventory_sync_notes', true );
        $notes = array_filter( $notes );

        if ( empty( $notes ) ) {
            echo '<p>' . esc_html__( 'No sync updates recorded yet.', 'ob-inventory-sync' ) . '</p>';
            return;
        }

        echo '<ul class="ob-inventory-sync-notes">';
        foreach ( array_reverse( $notes ) as $note ) {
            $date = isset( $note['date'] ) ? $note['date'] : '';
            $text = isset( $note['text'] ) ? $note['text'] : '';
            if ( $date && $text ) {
                $human = human_time_diff( strtotime( $date ), current_time( 'timestamp' ) ) . ' ' . __( 'ago', 'ob-inventory-sync' );
                echo '<li>';
                echo '<span class="ob-sync-note-time">' . esc_html( $human ) . '</span>';
                echo '<span class="ob-sync-note-text">' . esc_html( $text ) . '</span>';
                echo '</li>';
            }
        }
        echo '</ul>';
    }
}

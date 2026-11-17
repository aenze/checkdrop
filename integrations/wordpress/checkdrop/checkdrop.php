<?php
/**
 * Plugin Name: Checkdrop
 * Description: Connect WordPress forms to Checkdrop using a public site key. Field mapping and assistance are managed in Checkdrop.
 * Version: 0.2.0
 * Requires at least: 6.3
 * Requires PHP: 8.1
 * Text Domain: checkdrop
 * License: MIT
 * License URI: https://opensource.org/license/mit
 */

namespace Checkdrop\WordPress;

if (!defined('ABSPATH')) { exit; }

const OPTION = 'checkdrop_connection';
const VERSION = '0.2.0';
const HOSTED_SERVER = 'https://api.checkdrop.dev';

/** Origin of a self-hosted Checkdrop installation, or '' for the hosted service. HTTPS only. */
function valid_server($value): string {
    if (!is_string($value) || trim($value) === '') { return ''; }
    $parts = wp_parse_url(trim($value));
    if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host'])
        || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])
        || (isset($parts['path']) && $parts['path'] !== '/')) { return ''; }
    $origin = 'https://' . strtolower($parts['host']) . (isset($parts['port']) ? ':' . (int) $parts['port'] : '');
    return $origin === HOSTED_SERVER ? '' : $origin;
}

function admin_url_for(string $server): string {
    return $server === '' ? 'https://app.checkdrop.dev/integrations' : $server . '/integrations';
}

function valid_key($key): bool {
    return is_string($key) && preg_match('/\Acdp_site_[A-Za-z0-9-]{3,80}\z/', $key) === 1;
}

function settings(): array {
    $value = get_option(OPTION, array());
    return is_array($value) ? $value : array();
}

function sanitize_settings($input): array {
    if (!current_user_can('manage_options')) { return settings(); }
    $input = is_array($input) ? $input : array();
    $key = isset($input['site_key']) && is_string($input['site_key']) ? trim($input['site_key']) : '';
    if ($key !== '' && !valid_key($key)) {
        add_settings_error(OPTION, 'invalid_key', __('Vložte veřejný klíč začínající cdp_site_. Soukromý API klíč sem nepatří.', 'checkdrop'));
        // Never retain a submitted secret, or enable an old key after an invalid submission.
        $previous = settings();
        return array('site_key' => $previous['site_key'] ?? '', 'enabled' => false);
    }
    $raw_server = isset($input['server']) && is_string($input['server']) ? $input['server'] : '';
    $server = valid_server($raw_server);
    if (trim($raw_server) !== '' && $server === '' && untrailingslashit(trim($raw_server)) !== HOSTED_SERVER) {
        add_settings_error(OPTION, 'invalid_server', __('Adresa serveru musí začínat https:// a obsahovat jen doménu, například https://kontrola.example.cz.', 'checkdrop'));
        $previous = settings();
        return array('site_key' => $previous['site_key'] ?? '', 'server' => $previous['server'] ?? '', 'enabled' => false);
    }
    // WordPress can sanitize an option twice on its first save; keep this idempotent.
    return array('site_key' => $key, 'server' => $server, 'enabled' => valid_key($key) && in_array($input['enabled'] ?? false, array('1', true), true));
}

add_action('admin_init', function () {
    register_setting('checkdrop', OPTION, array('type' => 'array', 'sanitize_callback' => __NAMESPACE__ . '\\sanitize_settings', 'show_in_rest' => false));
});

add_action('admin_menu', function () {
    add_options_page('Checkdrop', 'Checkdrop', 'manage_options', 'checkdrop', __NAMESPACE__ . '\\render_settings');
});

function render_settings(): void {
    if (!current_user_can('manage_options')) { return; }
    $options = settings();
    ?>
    <div class="wrap">
      <h1>Checkdrop</h1>
      <p><?php esc_html_e('Připojte web veřejným klíčem. Formuláře, pole a režim kontrol nastavíte v Checkdropu.', 'checkdrop'); ?></p>
      <?php settings_errors(OPTION); ?>
      <form action="options.php" method="post">
        <?php settings_fields('checkdrop'); ?>
        <table class="form-table" role="presentation">
          <tr><th scope="row"><label for="checkdrop-key"><?php esc_html_e('Veřejný klíč webu', 'checkdrop'); ?></label></th>
          <td><input type="text" class="regular-text" id="checkdrop-key" name="checkdrop_connection[site_key]" value="<?php echo esc_attr($options['site_key'] ?? ''); ?>" placeholder="cdp_site_…" autocomplete="off" spellcheck="false" aria-describedby="checkdrop-key-help">
          <p class="description" id="checkdrop-key-help"><?php esc_html_e('Najdete ho v Integracích. Nevkládejte soukromý API klíč.', 'checkdrop'); ?></p></td></tr>
          <tr><th scope="row"><label for="checkdrop-server"><?php esc_html_e('Server Checkdropu', 'checkdrop'); ?></label></th>
          <td><input type="url" class="regular-text" id="checkdrop-server" name="checkdrop_connection[server]" value="<?php echo esc_attr($options['server'] ?? ''); ?>" placeholder="<?php echo esc_attr(HOSTED_SERVER); ?>" autocomplete="off" spellcheck="false" aria-describedby="checkdrop-server-help">
          <p class="description" id="checkdrop-server-help"><?php esc_html_e('Jen pro vlastní instalaci Checkdropu. Prázdné pole použije hostovanou službu.', 'checkdrop'); ?></p></td></tr>
          <tr><th scope="row"><?php esc_html_e('Vložení skriptu', 'checkdrop'); ?></th><td><label>
          <input type="checkbox" name="checkdrop_connection[enabled]" value="1" <?php checked(!empty($options['enabled'])); ?>>
          <?php esc_html_e('Povolit Checkdrop na webu', 'checkdrop'); ?></label>
          <p class="description"><?php esc_html_e('Před zapnutím nastavte v Checkdropu sledovací režim. Plugin sám neurčuje, zda se data opravují.', 'checkdrop'); ?></p></td></tr>
        </table>
        <?php submit_button(); ?>
      </form>
      <p><?php esc_html_e('Uložení klíče nepotvrzuje spojení. V Integracích ověřte příjem testovací události z tohoto webu.', 'checkdrop'); ?></p>
      <p><a href="<?php echo esc_url(admin_url_for($options['server'] ?? '')); ?>"><?php esc_html_e('Otevřít integrace v Checkdropu', 'checkdrop'); ?></a></p>
      <p><?php esc_html_e('Plugin nevyžaduje WooCommerce. Kompatibilitu konkrétního formuláře je potřeba ověřit; blokový checkout zatím není certifikován.', 'checkdrop'); ?></p>
      <p><?php esc_html_e('Při vypnutí odstraňte také případný ruční skript nebo GTM a vymažte cache webu. Již otevřené stránky je třeba obnovit.', 'checkdrop'); ?></p>
    </div>
    <?php
}

add_action('wp_enqueue_scripts', function () {
    $options = settings();
    if (is_admin() || empty($options['enabled']) || !valid_key($options['site_key'] ?? null)) { return; }
    wp_enqueue_script('checkdrop-loader', plugins_url('loader.js', __FILE__), array(), VERSION, array('in_footer' => true, 'strategy' => 'defer'));
});

add_filter('script_loader_tag', function ($tag, $handle) {
    if ($handle !== 'checkdrop-loader') { return $tag; }
    $options = settings();
    if (empty($options['enabled']) || !valid_key($options['site_key'] ?? null)) { return ''; }
    // WP constructs and escapes script attributes; other script handles remain untouched.
    $attributes = array('src' => plugins_url('loader.js', __FILE__) . '?ver=' . VERSION, 'id' => 'checkdrop-loader-js', 'defer' => true, 'data-checkdrop-wordpress-site' => $options['site_key']);
    $server = valid_server($options['server'] ?? '');
    if ($server !== '') { $attributes['data-checkdrop-wordpress-server'] = $server; }
    return wp_get_script_tag($attributes);
}, 10, 2);

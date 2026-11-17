<?php
// Isolated contract test; this is not a substitute for a real WordPress integration test.
define('ABSPATH', __DIR__);
$options = array(); $allowed = true; $errors = array(); $actions = array(); $filters = array(); $enqueued = array();
function get_option($name, $default) { global $options; return $options; }
function current_user_can($cap) { global $allowed; if ($cap !== 'manage_options') { throw new Exception('Wrong capability'); } return $allowed; }
function add_settings_error(...$args) { global $errors; $errors[] = $args; }
function __($text, $domain) { return $text; }
function add_action($name, $callback) { global $actions; $actions[$name] = $callback; }
function add_filter($name, $callback, ...$args) { global $filters; $filters[$name] = $callback; }
function is_admin() { return false; }
function plugins_url($path, $file) { return 'https://independent.test/wp-content/plugins/checkdrop/' . $path; }
function wp_enqueue_script(...$args) { global $enqueued; $enqueued[] = $args; }
require __DIR__ . '/../checkdrop/checkdrop.php';
function check($condition, $message) { if (!$condition) { throw new Exception($message); } }

check(\Checkdrop\WordPress\valid_key('cdp_site_shop-123'), 'Public key accepted');
foreach (array('', 'private-key', 'cdp_site_a', 'cdp_site_xxx<script>', array()) as $bad) {
    check(!\Checkdrop\WordPress\valid_key($bad), 'Invalid key rejected');
}
$clean = \Checkdrop\WordPress\sanitize_settings(array('site_key' => ' cdp_site_shop-123 ', 'enabled' => '1'));
check($clean === array('site_key' => 'cdp_site_shop-123', 'enabled' => true), 'Clean configuration');
check(\Checkdrop\WordPress\sanitize_settings($clean) === $clean, 'First save double sanitization is idempotent');
$options = $clean;
$invalid = \Checkdrop\WordPress\sanitize_settings(array('site_key' => 'private-secret', 'enabled' => '1'));
check($invalid['enabled'] === false && $invalid['site_key'] === $clean['site_key'], 'Invalid submission disables and does not persist secret');
check(count($errors) === 1, 'Explains invalid key');
$allowed = false;
check(\Checkdrop\WordPress\sanitize_settings(array()) === $options, 'Unauthorized change denied');
$allowed = true;
check(\Checkdrop\WordPress\sanitize_settings(array('site_key' => 'cdp_site_shop-123'))['enabled'] === false, 'Unchecked switch disables');
$options = array();
$actions['wp_enqueue_scripts']();
check(count($enqueued) === 0, 'New install is inactive');
$options = $clean;
$actions['wp_enqueue_scripts']();
check(count($enqueued) === 1 && $enqueued[0][0] === 'checkdrop-loader', 'Enqueues without WooCommerce');
check($filters['script_loader_tag']('<script>other</script>', 'other') === '<script>other</script>', 'Other scripts unaffected');
echo "WordPress settings contract: PASS\n";

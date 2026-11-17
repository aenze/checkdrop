<?php
// Run only inside the disposable QA container, never on a customer WordPress install.
if (getenv('CHECKDROP_WORDPRESS_QA') !== '1') { exit(1); }
define('WP_INSTALLING', true);
$_SERVER['HTTP_HOST'] = '127.0.0.1:4488';
$_SERVER['REQUEST_URI'] = '/';
require '/var/www/html/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/upgrade.php';
if (!is_blog_installed()) {
    wp_install('Checkdrop QA', 'checkdrop-qa', 'qa@example.test', false, '', 'Local-QA-only-2026!');
}
update_option('siteurl', 'http://127.0.0.1:4488');
update_option('home', 'http://127.0.0.1:4488');
require_once ABSPATH . 'wp-admin/includes/plugin.php';
$result = activate_plugin('checkdrop/checkdrop.php');
if (is_wp_error($result)) { throw new Exception($result->get_error_message()); }
delete_option('checkdrop_connection');
echo 'WP ' . get_bloginfo('version') . '; plugin activated; enabled=' . (get_option('checkdrop_connection', array())['enabled'] ?? 'false') . PHP_EOL;

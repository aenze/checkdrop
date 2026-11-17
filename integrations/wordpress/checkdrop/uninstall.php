<?php
if (!defined('WP_UNINSTALL_PLUGIN')) { exit; }
// Per-site configuration only. Never remove remote Checkdrop records on plugin deletion.
delete_option('checkdrop_connection');

<?php
// Taqnyat SMS relay — Taqnyat's own middleware (index.php, Oct 2026), made private.
//
// Taqnyat accepts a send only from an IP marked "allowed" in its portal's Security
// settings; Vercel's outgoing IP is not fixed, so the site posts here and this host
// (fixed IP, whitelisted in Taqnyat) forwards the message. It stores nothing: the
// bearer token, sender, recipients and body all arrive in the POST body.
//
// Changes from Taqnyat's copy:
//   - only a caller holding the shared key may use it (X-Relay-Key header); anyone
//     else would otherwise send through our whitelisted IP
//   - POST only — a GET would put the token in the URL and the access logs
//   - no CORS headers — the caller is a server, never a browser
//   - timeouts, so a hung Taqnyat cannot hang every SMS
//   - nothing about the message is logged
//
// The key comes from the TAQNYAT_RELAY_KEY environment variable or, on hosting
// without one, from relay-key.php ONE FOLDER ABOVE the web root, containing only:
//   <?php return 'the-same-long-random-key-as-in-vercel';
// Serve over HTTPS only. See README.md beside this file.

header("Content-Type: application/json");

function relayKey(): string {
    $key = getenv("TAQNYAT_RELAY_KEY");
    if (is_string($key) && strlen($key) >= 32) return $key;
    $file = dirname(__DIR__) . "/relay-key.php";
    if (is_file($file)) {
        $fromFile = require $file;
        if (is_string($fromFile) && strlen($fromFile) >= 32) return $fromFile;
    }
    return "";
}

function fail(int $status, string $error): void {
    http_response_code($status);
    echo json_encode(["error" => $error]);
    exit;
}

if (($_SERVER["REQUEST_METHOD"] ?? "") !== "POST") fail(405, "POST only");

$expected = relayKey();
$given = $_SERVER["HTTP_X_RELAY_KEY"] ?? "";
if ($expected === "") fail(500, "Relay key not configured");
if (!is_string($given) || !hash_equals($expected, $given)) fail(401, "Unauthorized");

$input = json_decode(file_get_contents("php://input"), true);
if (!is_array($input)) fail(400, "Body must be JSON");

foreach (["bearerTokens", "sender", "recipients", "body"] as $field) {
    if (!isset($input[$field])) fail(400, "Missing required parameters");
}

$recipients = is_array($input["recipients"]) ? $input["recipients"] : explode(",", (string) $input["recipients"]);
if (count($recipients) < 1 || count($recipients) > 1000) fail(400, "Recipients must be 1 to 1000 numbers");
foreach ($recipients as $r) {
    if (!preg_match('/^\d{8,15}$/', (string) $r)) fail(400, "Recipients must be digits without + or 00");
}

$ch = curl_init("https://api.taqnyat.sa/v1/messages");
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_HTTPHEADER => ["Authorization: Bearer " . $input["bearerTokens"], "Content-Type: application/json"],
    CURLOPT_POSTFIELDS => json_encode([
        "recipients" => array_values($recipients),
        "body" => (string) $input["body"],
        "sender" => (string) $input["sender"],
    ]),
]);
$response = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($response === false || $status === 0) fail(502, "Taqnyat unreachable");

// Taqnyat's status and answer, unchanged — the site reads them as if it had called Taqnyat itself.
http_response_code($status);
echo $response;

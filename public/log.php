<?php
// 开启错误显示，以便调试
ini_set('display_errors', 1);
error_reporting(E_ALL);

header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");

// --- 1. 配置数据库文件路径 (在网站根目录下) ---
// __DIR__ 是一个 PHP 魔术常量，代表当前 log.php 文件所在的目录
$dbPath = __DIR__ . '/data_storage/stats.sqlite';

$dbDir = dirname($dbPath);

// --- 2. 目录创建和权限检查 ---
if (!is_dir($dbDir)) {
    if (!@mkdir($dbDir, 0755, true)) {
        $error = error_get_last();
        http_response_code(500);
        echo json_encode([
            'status' => 'error',
            'message' => '创建数据目录失败。',
            'details' => '无法在 ' . htmlspecialchars($dbDir) . ' 创建目录。请检查权限。',
            'php_error' => isset($error['message']) ? $error['message'] : '无'
        ]);
        exit;
    }
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['status' => 'error', 'message' => '仅支持 POST 请求。']);
    exit;
}

$data = json_decode(file_get_contents('php://input'));

if (json_last_error() !== JSON_ERROR_NONE || !isset($data->songId)) {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => '请求数据无效。']);
    exit;
}

try {
    if (!extension_loaded('pdo_sqlite')) {
        throw new Exception("服务器未启用 pdo_sqlite 扩展。");
    }

    $pdo = new PDO('sqlite:' . $dbPath);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    $pdo->exec("CREATE TABLE IF NOT EXISTS song_plays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_address TEXT NOT NULL,
        song_id TEXT NOT NULL,
        play_time TEXT NOT NULL
    )");

    $stmt = $pdo->prepare("INSERT INTO song_plays (ip_address, song_id, play_time) VALUES (:ip, :song, :time)");

    $stmt->bindValue(':ip', $_SERVER['REMOTE_ADDR']);
    $stmt->bindValue(':song', $data->songId);
    date_default_timezone_set('Asia/Shanghai');
    $stmt->bindValue(':time', date('Y-m-d H:i:s'));

    $stmt->execute();

    http_response_code(200);
    echo json_encode(['status' => 'success', 'message' => '记录成功。']);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'status' => 'error',
        'message' => '数据库操作失败。',
        'details' => $e->getMessage()
    ]);
}
?>
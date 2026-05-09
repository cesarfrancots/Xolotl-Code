#[tauri::command]
#[specta::specta]
pub fn smoke_test() -> String {
    "smoke_test_ok".to_string()
}

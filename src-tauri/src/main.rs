// Opens the Threadline window. All app logic lives in ../src (HTML/CSS/JS);
// this file just starts Tauri with the plugins the page uses turned on.
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init()) // native pop-ups, e.g. "Are you sure?"
        .plugin(tauri_plugin_opener::init()) // open links in the default browser
        .plugin(tauri_plugin_notification::init()) // local notifications for Signals flags
        .run(tauri::generate_context!())
        .expect("error while running Threadline");
}

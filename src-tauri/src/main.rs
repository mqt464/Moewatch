#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent, menu::{Menu, MenuItem}, tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState}};
use tauri_plugin_shell::{ShellExt, process::CommandChild};
use std::{sync::{Arc, Mutex}, net::{TcpListener, TcpStream}, time::Duration};
#[derive(Clone)]
struct Server(Arc<Mutex<Option<CommandChild>>>);
impl Server {
 fn stop(&self) { if let Some(child) = self.0.lock().unwrap().take() { let _ = child.kill(); } }
}
impl Drop for Server {
 fn drop(&mut self) { self.stop(); }
}
impl tauri::Resource for Server {
 fn close(self: Arc<Self>) { self.stop(); }
}
fn show_main(app: &tauri::AppHandle) {
 if let Some(window) = app.get_webview_window("main") {
  let _ = window.show(); let _ = window.unminimize(); let _ = window.set_focus();
 }
}
fn keep_running(app: &tauri::AppHandle) -> bool {
 app.path().app_data_dir().ok()
  .and_then(|path| std::fs::read(path.join("shared-access.json")).ok())
  .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
  .and_then(|value| value.get("keepRunning").and_then(|value| value.as_bool()))
  .unwrap_or(false)
}
fn main() {
 let app = tauri::Builder::default()
  .plugin(tauri_plugin_shell::init())
  .plugin(tauri_plugin_updater::Builder::new().build())
  .plugin(tauri_plugin_process::init())
  .plugin(tauri_plugin_opener::init())
  .setup(|app| {
   let listener = TcpListener::bind("127.0.0.1:17846")?;
   let port = listener.local_addr()?.port(); drop(listener);
   let data = app.path().app_data_dir()?; std::fs::create_dir_all(&data)?;
   let resource_root = app.path().resource_dir()?;
   let resources = resource_root.join("dist");
   let (_events, child) = app.shell().sidecar("moewatch-server")?
    .env("MOEWATCH_PORT", port.to_string())
    .env("MOEWATCH_DATA_DIR", data.to_string_lossy().to_string())
    .env("MOEWATCH_SESSION_FILE", data.join("sessions.json").to_string_lossy().to_string())
    .env("MOEWATCH_STATIC_DIR", resources.to_string_lossy().to_string()).spawn()?;
   let server = Server(Arc::new(Mutex::new(Some(child))));
   // Updater exits bypass RunEvent::Exit but clear the resource table first.
   app.resources_table().add(server.clone());
   app.manage(server);
   let address = format!("127.0.0.1:{port}");
   let mut ready = false;
   for _ in 0..200 {
    if TcpStream::connect(&address).is_ok() { ready = true; break; }
    std::thread::sleep(Duration::from_millis(50));
   }
   if !ready { return Err("Moewatch server did not start".into()); }
   WebviewWindowBuilder::new(app, "main", WebviewUrl::External(format!("http://{address}").parse()?))
    .title("Moewatch").inner_size(1360.0, 900.0).min_inner_size(800.0, 600.0)
    .on_navigation(move |url| url.host_str() == Some("127.0.0.1") && url.port() == Some(port))
    .build()?;
   let show = MenuItem::with_id(app, "show", "Open Moewatch", true, None::<&str>)?;
   let quit = MenuItem::with_id(app, "quit", "Quit Moewatch", true, None::<&str>)?;
   let menu = Menu::with_items(app, &[&show, &quit])?;
   TrayIconBuilder::new()
    .icon(app.default_window_icon().ok_or("Missing application icon")?.clone())
    .tooltip("Moewatch")
    .menu(&menu)
    .show_menu_on_left_click(false)
    .on_menu_event(|app, event| match event.id.as_ref() {
     "show" => show_main(app),
     "quit" => app.exit(0),
     _ => {}
    })
    .on_tray_icon_event(|tray, event| {
     if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event { show_main(tray.app_handle()); }
    })
    .build(app)?;
   Ok(())
  })
  .on_window_event(|window, event| {
   if window.label() == "main" {
    if let WindowEvent::CloseRequested { api, .. } = event {
     if keep_running(window.app_handle()) {
      if window.hide().is_ok() { api.prevent_close(); }
     }
    }
   }
  }).build(tauri::generate_context!()).expect("Unable to start Moewatch");
 app.run(|app, event| { if let tauri::RunEvent::Exit = event {
  if let Some(server) = app.try_state::<Server>() { server.stop(); }
 }});
}

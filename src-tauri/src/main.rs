#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
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
   let resources = app.path().resource_dir()?.join("dist");
   let (_events, child) = app.shell().sidecar("moewatch-server")?
    .env("MOEWATCH_PORT", port.to_string())
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
   Ok(())
  }).build(tauri::generate_context!()).expect("Unable to start Moewatch");
 app.run(|app, event| { if let tauri::RunEvent::Exit = event {
  if let Some(server) = app.try_state::<Server>() { server.stop(); }
 }});
}

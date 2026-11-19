// Exercise the file service in a test executable, using the Windows v6 manifest.
// Private encoding helpers remain testable next to their implementation.
#![allow(dead_code)]
#[path = "../src/api_server.rs"]
mod api_server;
#[path = "../src/library.rs"]
mod library;

/// The handful of things that differ between the browser and a desktop build:
/// saving a file, reading an Apps Script reply, and the storage the React
/// version of this app left behind.
library;

export 'platform_io.dart' if (dart.library.js_interop) 'platform_web.dart';
export 'script_failure.dart';

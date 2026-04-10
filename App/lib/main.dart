/// CodeTwin app entry point.
///
/// On launch:
/// 1. Initialize notifications
/// 2. Load saved pairing from secure storage
/// 3. If paired, connect to the signaling server
/// 4. Run the app inside a Riverpod ProviderScope

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'app.dart';
import 'services/notifications_service.dart';
import 'services/socket_service.dart';
import 'utils/device_id.dart';
import 'providers/onboarding_provider.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Load shared preferences BEFORE app starts
  final sharedPrefs = await SharedPreferences.getInstance();

  // Initialise local notifications
  await NotificationsService().init();
  await NotificationsService().requestPermission();

  // Check for existing pairing
  final pairing = await loadPairing();

  // Track foreground/background for notification routing
  final lifecycleListener = AppLifecycleListener(
    onStateChange: (state) {
      final isForeground = state == AppLifecycleState.resumed;
      NotificationsService().setAppInForeground(isForeground);
    },
  );

  // If already paired, connect immediately
  if (pairing != null) {
    SocketService().connect(pairing.signalingUrl, pairing.deviceId);
  }

  runApp(
    ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(sharedPrefs),
      ],
      child: const App(),
    ),
  );

  // Keep the listener reference alive (avoid GC)
  // ignore: unused_local_variable
  final _ = lifecycleListener;
}

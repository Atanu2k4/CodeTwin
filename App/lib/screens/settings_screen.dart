/// Settings screen — pairing info, level override, notifications, app version.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/connection_provider.dart';
import '../providers/session_provider.dart';
import '../providers/notifications_provider.dart';
import '../providers/daemon_actions_provider.dart';
import '../models/session_status.dart';
import '../widgets/level_picker.dart';
import '../utils/device_id.dart';
import '../services/socket_service.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  final _urlController = TextEditingController();
  bool _editingUrl = false;

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final conn = ref.watch(connectionProvider).valueOrNull ??
        DaemonConnectionState.empty;
    final session =
        ref.watch(sessionProvider).valueOrNull ?? SessionState.empty;
    final notif =
        ref.watch(notificationsProvider).valueOrNull ??
        const NotificationsState();
    final actions = ref.read(daemonActionsProvider);
    final theme = Theme.of(context);

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        physics: const BouncingScrollPhysics(),
        children: [
          // ── Pairing ─────────────────────────────────────────────────
          _sectionHeader(theme, 'Pairing & Device'),
          Container(
            decoration: BoxDecoration(
              color: const Color(0xFF16161A),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.fingerprint, color: Colors.white70),
                  title: const Text('Device ID', style: TextStyle(color: Colors.white)),
                  subtitle: Text(
                    conn.deviceId ?? 'Not paired',
                    style: TextStyle(fontFamily: 'monospace', color: Colors.white.withValues(alpha: 0.4)),
                  ),
                ),
                Divider(height: 1, color: Colors.white.withValues(alpha: 0.05)),
                ListTile(
                  leading: const Icon(Icons.cloud, color: Colors.white70),
                  title: const Text('Signaling URL', style: TextStyle(color: Colors.white)),
                  subtitle: _editingUrl
                      ? TextField(
                          controller: _urlController,
                          style: const TextStyle(color: Colors.white),
                          decoration: InputDecoration(
                            isDense: true,
                            enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: const Color(0xFF20B2AA).withValues(alpha: 0.5))),
                            focusedBorder: const UnderlineInputBorder(borderSide: BorderSide(color: Color(0xFF20B2AA))),
                            suffixIcon: IconButton(
                              icon: const Icon(Icons.check, color: Color(0xFF20B2AA)),
                              onPressed: () {
                                final url = _urlController.text.trim();
                                if (url.isNotEmpty) {
                                  ref
                                      .read(connectionProvider.notifier)
                                      .setSignalingUrl(url);
                                  if (conn.deviceId != null) {
                                    SocketService().connect(url, conn.deviceId!);
                                  }
                                }
                                setState(() => _editingUrl = false);
                              },
                            ),
                          ),
                        )
                      : Text(conn.signalingUrl, style: TextStyle(color: Colors.white.withValues(alpha: 0.4))),
                  trailing: _editingUrl
                      ? null
                      : IconButton(
                          icon: const Icon(Icons.edit, size: 18, color: Colors.white54),
                          onPressed: () {
                            _urlController.text = conn.signalingUrl;
                            setState(() => _editingUrl = true);
                          },
                        ),
                ),
                Divider(height: 1, color: Colors.white.withValues(alpha: 0.05)),
                ListTile(
                  leading: const Icon(Icons.sync, color: Colors.white70),
                  title: const Text('Connection', style: TextStyle(color: Colors.white)),
                  subtitle: Text(conn.pairingStatus.name, style: TextStyle(color: Colors.white.withValues(alpha: 0.4))),
                  trailing: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                    decoration: BoxDecoration(
                      color: conn.daemonConnected ? Colors.teal.withValues(alpha: 0.15) : Colors.red.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: conn.daemonConnected ? Colors.teal : Colors.red,
                        width: 1,
                      )
                    ),
                    child: Text(
                      conn.daemonConnected ? 'ONLINE' : 'OFFLINE',
                      style: TextStyle(
                        color: conn.daemonConnected ? Colors.tealAccent : Colors.redAccent,
                        fontSize: 10,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  )
                ),
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: () async {
                        await clearPairing();
                        SocketService().disconnect();
                        ref
                            .read(connectionProvider.notifier)
                            .setPairingStatus(
                                PairingStatus.unpaired);
                        if (context.mounted) context.go('/pair');
                      },
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        side: BorderSide(color: Colors.redAccent.withValues(alpha: 0.5)),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        foregroundColor: Colors.redAccent,
                      ),
                      icon: const Icon(Icons.link_off),
                      label: const Text('Disconnect & Re-pair'),
                    ),
                  ),
                ),
              ]
            ),
          ),

          const SizedBox(height: 24),

          // ── Dependence Level ─────────────────────────────────────────
          _sectionHeader(theme, 'Agent Autonomy'),
          Container(
            decoration: BoxDecoration(
              color: const Color(0xFF16161A),
              borderRadius: BorderRadius.circular(20),
            ),
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: LevelPicker(
              currentLevel: session.dependenceLevel,
              onChanged: (level) {
                ref.read(sessionProvider.notifier).setLevel(level);
                actions.changeLevel(level);
              },
            ),
          ),

          const SizedBox(height: 24),

          // ── Notifications ───────────────────────────────────────────
          _sectionHeader(theme, 'System'),
          Container(
            decoration: BoxDecoration(
              color: const Color(0xFF16161A),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Column(
              children: [
                SwitchListTile(
                  title: const Text('Push notifications', style: TextStyle(color: Colors.white)),
                  subtitle: Text(
                    'Receive alerts when the agent needs approval or a task completes.',
                    style: TextStyle(color: Colors.white.withValues(alpha: 0.4)),
                  ),
                  activeColor: const Color(0xFF20B2AA),
                  value: notif.enabled,
                  onChanged: (v) =>
                      ref.read(notificationsProvider.notifier).setEnabled(v),
                ),
                Divider(height: 1, color: Colors.white.withValues(alpha: 0.05)),
                ListTile(
                  leading: const Icon(Icons.info_outline, color: Colors.white70),
                  title: const Text('CodeTwin Version', style: TextStyle(color: Colors.white)),
                  trailing: Text('v1.0.0 (Premium)', style: TextStyle(color: Colors.white.withValues(alpha: 0.4))),
                ),
              ]
            ),
          ),
          const SizedBox(height: 32),
        ],
      ),
    );
  }

  Widget _sectionHeader(ThemeData theme, String title) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 0, 16, 8),
      child: Text(
        title.toUpperCase(),
        style: const TextStyle(
          color: Color(0xFF20B2AA),
          fontSize: 12,
          fontWeight: FontWeight.w800,
          letterSpacing: 1.5,
        ),
      ),
    );
  }
}

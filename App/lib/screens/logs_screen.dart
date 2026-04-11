/// Streaming agent log viewer with filter and auto-scroll.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/session_status.dart';
import '../providers/session_provider.dart';
import '../widgets/agent_log_list.dart';
import '../widgets/process_timeline_list.dart';

enum _LogsViewMode { timeline, raw }

class LogsScreen extends ConsumerStatefulWidget {
  const LogsScreen({super.key});

  @override
  ConsumerState<LogsScreen> createState() => _LogsScreenState();
}

class _LogsScreenState extends ConsumerState<LogsScreen> {
  AgentLogLevel? _filter;
  _LogsViewMode _mode = _LogsViewMode.timeline;

  @override
  Widget build(BuildContext context) {
    final session =
        ref.watch(sessionProvider).valueOrNull ?? SessionState.empty;

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: const Text('Agent Logs'),
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_outline),
            tooltip: 'Clear logs',
            onPressed: () => ref.read(sessionProvider.notifier).clearLogs(),
          ),
        ],
      ),
      body: Column(
        children: [
          // View mode switch
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 4),
            child: Row(
              children: [
                _modeChip('Process Timeline', _LogsViewMode.timeline),
                const SizedBox(width: 8),
                _modeChip('Raw Logs', _LogsViewMode.raw),
              ],
            ),
          ),

          // Filter bar
          if (_mode == _LogsViewMode.raw)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Wrap(
                alignment: WrapAlignment.center,
                spacing: 8.0,
                runSpacing: 8.0,
                children: [
                  _buildChip('All', null),
                  _buildChip('Info', AgentLogLevel.info),
                  _buildChip('Warn', AgentLogLevel.warn),
                  _buildChip('Error', AgentLogLevel.error),
                  _buildChip('Tool', AgentLogLevel.tool),
                ],
              ),
            ),

          // Log list
          Expanded(
            child: session.logs.isEmpty
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(24),
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: const Color(0xFF20B2AA).withValues(alpha: 0.1),
                            border: Border.all(
                              color: const Color(0xFF20B2AA).withValues(alpha: 0.2),
                              width: 2,
                            ),
                            boxShadow: [
                              BoxShadow(
                                color: const Color(0xFF20B2AA).withValues(alpha: 0.05),
                                blurRadius: 20,
                              ),
                            ]
                          ),
                          child: const Icon(Icons.code,
                              size: 48,
                              color: Color(0xFF20B2AA)),
                        ),
                        const SizedBox(height: 24),
                        Text(
                          'Awaiting Telemetry',
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.9),
                            fontSize: 20,
                            fontWeight: FontWeight.w600,
                            letterSpacing: 1.2,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Agent execution logs will appear here secure & encrypted.',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.4),
                            fontSize: 14,
                            height: 1.5,
                          ),
                        ),
                      ],
                    ),
                  )
                : (_mode == _LogsViewMode.timeline
                    ? ProcessTimelineList(logs: session.logs)
                    : AgentLogList(logs: session.logs, filter: _filter)),
          ),
        ],
      ),
    );
  }

  Widget _modeChip(String label, _LogsViewMode value) {
    final isSelected = _mode == value;
    final primaryColor = const Color(0xFF20B2AA);

    return GestureDetector(
      onTap: () => setState(() => _mode = value),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected ? primaryColor.withValues(alpha: 0.2) : const Color(0xFF16161A),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isSelected ? primaryColor : Colors.white.withValues(alpha: 0.1),
            width: 1.5,
          ),
        ),
        child: Text(
          label.toUpperCase(),
          style: TextStyle(
            color: isSelected ? primaryColor : Colors.white.withValues(alpha: 0.55),
            fontSize: 11,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.7,
          ),
        ),
      ),
    );
  }

  Widget _buildChip(String label, AgentLogLevel? value) {
    final isSelected = _filter == value;
    final primaryColor = const Color(0xFF20B2AA);

    return GestureDetector(
      onTap: () => setState(() => _filter = value),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected ? primaryColor.withValues(alpha: 0.2) : const Color(0xFF16161A),
          borderRadius: BorderRadius.circular(16), // Slightly tighter radius
          border: Border.all(
            color: isSelected ? primaryColor : Colors.white.withValues(alpha: 0.1),
            width: 1.5,
          ),
          boxShadow: [
            if (isSelected)
              BoxShadow(
                color: primaryColor.withValues(alpha: 0.15),
                blurRadius: 10,
              )
          ]
        ),
        child: Text(
          label.toUpperCase(),
          style: TextStyle(
            color: isSelected ? primaryColor : Colors.white.withValues(alpha: 0.5),
            fontSize: 11, // Downscaled from 12 for narrow fit
            fontWeight: FontWeight.w700,
            letterSpacing: 0.8,
          ),
        ),
      ),
    );
  }
}

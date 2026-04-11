import 'package:flutter/material.dart';
import '../models/log_entry.dart';
import '../theme/cli_theme.dart';
import '../utils/formatters.dart';

class ProcessTimelineList extends StatelessWidget {
  final List<LogEntry> logs;

  const ProcessTimelineList({super.key, required this.logs});

  @override
  Widget build(BuildContext context) {
    final events = logs.where(_isTimelineEvent).toList();

    if (events.isEmpty) {
      final cli = CliTheme.of(context);
      return Center(
        child: Text(
          'No process timeline events yet',
          style: cli.mono.copyWith(color: cli.textDim),
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 20),
      itemCount: events.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, index) => _TimelineTile(entry: events[index]),
    );
  }
}

bool _isTimelineEvent(LogEntry log) {
  if (log.source != LogSource.structured) return false;
  final type = log.structuredType;
  return type != null && type != 'text';
}

class _TimelineTile extends StatelessWidget {
  final LogEntry entry;

  const _TimelineTile({required this.entry});

  @override
  Widget build(BuildContext context) {
    final cli = CliTheme.of(context);
    final (IconData icon, Color color, String label) = switch (entry.structuredType) {
      'reasoning' => (Icons.psychology_alt_outlined, cli.cyan, 'Thinking'),
      'step_start' => (Icons.play_arrow_rounded, cli.amber, 'Step start'),
      'step_finish' => (Icons.check_circle_outline, cli.accent, 'Step finish'),
      'tool_use' => (Icons.build_circle_outlined, cli.accent, 'Tool update'),
      'awaiting_approval' => (Icons.help_outline, cli.amber, 'Awaiting approval'),
      'approval_resolved' => (Icons.task_alt, cli.accent, 'Approval resolved'),
      'error' => (Icons.error_outline, cli.red, 'Error'),
      _ => (Icons.circle_outlined, cli.textDim, entry.structuredType ?? 'Event'),
    };

    final longText = entry.message.length > 180;

    return Container(
      decoration: cli.box(borderColor: cli.border),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 15, color: color),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    label,
                    style: cli.mono.copyWith(
                      color: color,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 1.0,
                    ),
                  ),
                ),
                Text(
                  formatTimestamp(entry.timestamp),
                  style: cli.mono.copyWith(color: cli.textDim, fontSize: 10),
                ),
              ],
            ),
            const SizedBox(height: 6),
            if (!longText)
              Text(
                entry.message,
                style: cli.mono.copyWith(color: cli.text, fontSize: 12, height: 1.35),
              )
            else
              Theme(
                data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
                child: ExpansionTile(
                  tilePadding: EdgeInsets.zero,
                  childrenPadding: const EdgeInsets.only(top: 4),
                  collapsedIconColor: cli.textDim,
                  iconColor: cli.accent,
                  title: Text(
                    '${entry.message.substring(0, 140)}...',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: cli.mono.copyWith(color: cli.text, fontSize: 12, height: 1.25),
                  ),
                  children: [
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        entry.message,
                        style: cli.mono.copyWith(color: cli.textDim, fontSize: 12, height: 1.35),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

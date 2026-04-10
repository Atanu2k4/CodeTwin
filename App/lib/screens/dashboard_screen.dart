/// Dashboard — active session view with task input, preflight/decision cards, log preview.
/// CLI-themed redesign — all backend logic unchanged.

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../models/session_status.dart';
import '../providers/session_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/daemon_actions_provider.dart';
import '../widgets/session_status_badge.dart';
import '../widgets/preflight_card.dart';
import '../widgets/decision_card.dart';
import '../widgets/task_input.dart';
import '../widgets/level_picker.dart';
import '../widgets/agent_log_list.dart';
import '../widgets/chat_message_list.dart';
import '../utils/formatters.dart';
import '../theme/cli_theme.dart';




// ── Blinking cursor widget ────────────────────────────────────────────────────
class _BlinkingCursor extends StatefulWidget {
  final Color? color;
  const _BlinkingCursor({this.color});

  @override
  State<_BlinkingCursor> createState() => _BlinkingCursorState();
}

class _BlinkingCursorState extends State<_BlinkingCursor> {
  bool _visible = true;
  late final Timer _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(milliseconds: 530), (_) {
      if (mounted) setState(() => _visible = !_visible);
    });
  }

  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cli = CliTheme.of(context);
    return AnimatedOpacity(

        opacity: _visible ? 1 : 0,
        duration: const Duration(milliseconds: 80),
        child: Text('█', style: cli.mono.copyWith(color: widget.color ?? cli.accent, fontSize: 14)),
      );
  }
}

// ── CLI section header ────────────────────────────────────────────────────────
class _CliHeader extends StatelessWidget {
  final String label;
  final Widget? trailing;
  const _CliHeader(this.label, {this.trailing});

  @override
  Widget build(BuildContext context) {
    final cli = CliTheme.of(context);
    return Padding(

        padding: const EdgeInsets.fromLTRB(16, 12, 16, 6),
        child: Row(
          children: [
            Text('┌─ ', style: cli.mono.copyWith(color: cli.accentDim, fontSize: 12)),
            Text(label.toUpperCase(),
                style: cli.mono.copyWith(
                    color: cli.accent,
                    fontSize: 11,
                    letterSpacing: 2,
                    fontWeight: FontWeight.bold)),
            Text(' ─', style: cli.mono.copyWith(color: cli.accentDim, fontSize: 12)),
            Expanded(
              child: Text(
                '─' * 40,
                maxLines: 1,
                overflow: TextOverflow.clip,
                style: cli.mono.copyWith(color: cli.border, fontSize: 12),
              ),
            ),
            if (trailing != null) trailing!,
          ],
        ),
      );
  }
}

// ── Fade-slide-in wrapper ─────────────────────────────────────────────────────
class _FadeSlide extends StatefulWidget {
  final Widget child;
  final Duration delay;
  const _FadeSlide({required this.child, this.delay = Duration.zero});

  @override
  State<_FadeSlide> createState() => _FadeSlideState();
}

class _FadeSlideState extends State<_FadeSlide>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;
  late final Animation<double> _fade;
  late final Animation<Offset> _slide;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 400));
    _fade = CurvedAnimation(parent: _ctrl, curve: Curves.easeOut);
    _slide = Tween(begin: const Offset(0, 0.06), end: Offset.zero)
        .animate(CurvedAnimation(parent: _ctrl, curve: Curves.easeOutCubic));
    Future.delayed(widget.delay, () {
      if (mounted) _ctrl.forward();
    });
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FadeTransition(
        opacity: _fade,
        child: SlideTransition(position: _slide, child: widget.child),
      );
}

// ── Main screen ───────────────────────────────────────────────────────────────
class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session =
        ref.watch(sessionProvider).valueOrNull ?? SessionState.empty;
    final conn = ref.watch(connectionProvider).valueOrNull ??
        DaemonConnectionState.empty;
    final actions = ref.read(daemonActionsProvider);

    return CliTheme(
      level: session.dependenceLevel,
      child: Builder(
        builder: (context) {
          final cli = CliTheme.of(context);
          return Container(

            color: cli.bg,
            child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // ── Scrollable Area ──────────────────────────────────────
          Expanded(
            child: AnimatedSize(
              duration: const Duration(milliseconds: 350),
              curve: Curves.easeOutCubic,
              alignment: Alignment.topCenter,
              child: CustomScrollView(
                slivers: [
                  SliverToBoxAdapter(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        // ── Status bar ───────────────────────────────────
                        _FadeSlide(
                          child: _StatusBar(session: session, actions: actions),
                        ),

                        // ── Preflight queue ──────────────────────────────
                        if (session.preflightQueue.isNotEmpty)
                          _FadeSlide(
                            delay: const Duration(milliseconds: 60),
                            child: _CliSection(
                              label: 'PREFLIGHT',
                              borderColor: cli.amber,
                              child: PreflightCard(
                                item: session.preflightQueue.first,
                                onApprove: (id) {
                                  actions.approve(id);
                                  ref
                                      .read(sessionProvider.notifier)
                                      .resolvePreflight(id);
                                },
                                onReject: (id) {
                                  actions.reject(id);
                                  ref
                                      .read(sessionProvider.notifier)
                                      .resolvePreflight(id);
                                },
                                onModify: (id, text) {
                                  actions.answer(id, text);
                                  ref
                                      .read(sessionProvider.notifier)
                                      .resolvePreflight(id);
                                },
                              ),
                            ),
                          ),

                        // ── Decision queue ───────────────────────────────
                        if (session.decisionQueue.isNotEmpty)
                          _FadeSlide(
                            delay: const Duration(milliseconds: 60),
                            child: _CliSection(
                              label: 'DECISION REQUIRED',
                              borderColor: cli.cyan,
                              child: DecisionCard(
                                item: session.decisionQueue.first,
                                onAnswer: (id, answer) {
                                  actions.answer(id, answer);
                                  ref
                                      .read(sessionProvider.notifier)
                                      .resolveDecision(id);
                                },
                                onReject: (id) {
                                  actions.reject(id);
                                  ref
                                      .read(sessionProvider.notifier)
                                      .resolveDecision(id);
                                },
                              ),
                            ),
                          ),

                        // ── Last completed ───────────────────────────────
                        if (session.lastComplete != null &&
                            session.status == SessionStatus.idle)
                          _FadeSlide(
                            delay: const Duration(milliseconds: 80),
                            child: _TerminalResultCard(
                              isSuccess: true,
                              title: 'TASK COMPLETED',
                              body: session.lastComplete!.summary,
                              meta:
                                  '${session.lastComplete!.filesChanged.length} files changed'
                                  '  ·  ${formatDurationMs(session.lastComplete!.durationMs)}',
                            ),
                          ),

                        // ── Last failed ──────────────────────────────────
                        if (session.lastFailed != null &&
                            session.status == SessionStatus.failed)
                          _FadeSlide(
                            delay: const Duration(milliseconds: 80),
                            child: _TerminalResultCard(
                              isSuccess: false,
                              title: 'TASK FAILED',
                              body: session.lastFailed!.error,
                            ),
                          ),

                        // ── Task Progress header ─────────────────────────
                        if (session.logs.isNotEmpty &&
                            session.preflightQueue.isEmpty &&
                            session.decisionQueue.isEmpty)
                          _FadeSlide(
                            child: _CliHeader(
                              'Task Progress',
                              trailing: TextButton(
                                onPressed: () => context.go('/logs'),
                                style: TextButton.styleFrom(
                                  foregroundColor: cli.cyan,
                                  textStyle: cli.mono.copyWith(fontSize: 11),
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 8, vertical: 4),
                                ),
                                child: const Text('raw logs →'),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),

                  // ── Chat log fills remaining space ───────────────────
                  if (session.logs.isNotEmpty &&
                      session.preflightQueue.isEmpty &&
                      session.decisionQueue.isEmpty)
                    SliverFillRemaining(
                      hasScrollBody: true,
                      child: Padding(
                        padding: const EdgeInsets.only(bottom: 24),
                        child: ChatMessageList(logs: session.logs),
                      ),
                    ),
                ],
              ),
            ),
          ),

          // ── Static bottom input area ─────────────────────────────────
          _BottomBar(session: session, actions: actions, ref: ref),
        ],
      ),
          );
        },
      ),
    );
  }
}

// ── Status bar ────────────────────────────────────────────────────────────────
class _StatusBar extends StatelessWidget {
  final SessionState session;
  final dynamic actions;

  const _StatusBar({required this.session, required this.actions});

  @override
  Widget build(BuildContext context) {
    final cli = CliTheme.of(context);
    final isRunning = session.status == SessionStatus.running;

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 16, 16, 4),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: cli.box(
        borderColor: isRunning ? cli.accent : cli.border,
        bgColor: isRunning ? cli.accentMuted : cli.surface,
      ),
      child: Row(
        children: [
          // Prompt prefix
          Text('~/codetwin ', style: cli.mono.copyWith(color: cli.textDim, fontSize: 12)),
          Text('\$ ', style: cli.mono.copyWith(color: cli.accent, fontSize: 12)),
          // Status badge (unchanged widget)
          SessionStatusBadge(status: session.status),
          const Spacer(),
          if (isRunning) ...[
            _BlinkingCursor(color: cli.accent),
            const SizedBox(width: 8),
            TextButton.icon(
              onPressed: () => actions.cancelTask(),
              icon: Text('[', style: cli.mono.copyWith(color: cli.red)),
              label: Text(
                'SIGINT',
                style: cli.mono.copyWith(
                    color: cli.red, fontSize: 11, fontWeight: FontWeight.bold),
              ),
              style: TextButton.styleFrom(
                foregroundColor: cli.red,
                padding:
                    const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
                side: BorderSide(color: cli.red, width: 1),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(3)),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// ── Wraps a child in a CLI-styled bordered section ────────────────────────────
class _CliSection extends StatelessWidget {
  final String label;
  final Widget child;
  final Color? borderColor;

  const _CliSection(
      {required this.label, required this.child, this.borderColor});

  @override
  Widget build(BuildContext context) {
    final cli = CliTheme.of(context);
    return Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
        child: Container(
          decoration: cli.box(borderColor: borderColor ?? cli.border),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: (borderColor ?? cli.accentDim).withValues(alpha: 0.12),
                  borderRadius:
                      const BorderRadius.vertical(top: Radius.circular(4)),
                  border: Border(
                      bottom: BorderSide(
                          color: borderColor ?? cli.border, width: 1)),
                ),
                child: Text(
                  '▸ $label',
                  style: cli.mono.copyWith(
                      color: borderColor ?? cli.accent,
                      fontSize: 10,
                      letterSpacing: 1.5,
                      fontWeight: FontWeight.bold),
                ),
              ),
              child,
            ],
          ),
        ),
      );
  }
}

// ── Terminal result card (success / failure) ──────────────────────────────────
class _TerminalResultCard extends StatelessWidget {
  final bool isSuccess;
  final String title;
  final String body;
  final String? meta;

  const _TerminalResultCard({
    required this.isSuccess,
    required this.title,
    required this.body,
    this.meta,
  });

  @override
  Widget build(BuildContext context) {
    final cli = CliTheme.of(context);
    final accent = isSuccess ? cli.accent : cli.red;

    final bgColor = isSuccess ? cli.accentMuted : cli.redMuted;
    final icon = isSuccess ? '✓' : '✗';

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      child: Container(
        decoration: cli.box(borderColor: accent, bgColor: bgColor),
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text('$icon ', style: cli.mono.copyWith(color: accent, fontSize: 14)),
                Text(
                  title,
                  style: cli.mono.copyWith(
                      color: accent,
                      fontSize: 11,
                      letterSpacing: 1.5,
                      fontWeight: FontWeight.bold),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              body,
              style: cli.mono.copyWith(color: cli.text, fontSize: 13, height: 1.5),
            ),
            if (meta != null) ...[
              const SizedBox(height: 6),
              Text(
                meta!,
                style: cli.mono.copyWith(color: cli.textDim, fontSize: 11),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// ── Bottom input bar ──────────────────────────────────────────────────────────
class _BottomBar extends StatelessWidget {
  final SessionState session;
  final dynamic actions;
  final WidgetRef ref;

  const _BottomBar(
      {required this.session, required this.actions, required this.ref});

  @override
  Widget build(BuildContext context) {
    final cli = CliTheme.of(context);
    final isIdle = session.status == SessionStatus.idle &&

        session.preflightQueue.isEmpty &&
        session.decisionQueue.isEmpty;

    return Container(
      decoration: BoxDecoration(
        color: cli.bg,
        border: Border(top: BorderSide(color: cli.border, width: 1)),
      ),
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
      child: AnimatedSize(
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOutCubic,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (isIdle) ...[
              // Terminal-style prompt row above the input widget
              Padding(
                padding: const EdgeInsets.only(bottom: 6, left: 2),
                child: Row(
                  children: [
                    Text('codetwin', style: cli.mono.copyWith(color: cli.accentDim, fontSize: 10)),
                    Text('@agent', style: cli.mono.copyWith(color: cli.textDim, fontSize: 10)),
                    Text(' % ', style: cli.mono.copyWith(color: cli.accent, fontSize: 10)),
                  ],
                ),
              ),
              TaskInput(
                enabled: true,
                onSubmit: (task) => actions.submitTask(task),
              ),
              const SizedBox(height: 16),
            ],

            // ── Level picker ─────────────────────────────────────────
            Container(
              decoration: cli.box(),
              padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(left: 10, bottom: 4),
                    child: Text(
                      'DEPENDENCE LEVEL',
                      style: cli.mono.copyWith(
                          color: cli.textDim,
                          fontSize: 9,
                          letterSpacing: 1.8),
                    ),
                  ),
                  LevelPicker(
                    currentLevel: session.dependenceLevel,
                    showDetails: false,
                    onChanged: (level) {
                      ref.read(sessionProvider.notifier).setLevel(level);
                      actions.changeLevel(level);
                    },
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

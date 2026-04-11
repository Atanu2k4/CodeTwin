import 'package:flutter/material.dart';
import '../models/log_entry.dart';
import '../models/session_status.dart';
import '../theme/cli_theme.dart';

class ChatMessageList extends StatefulWidget {
  final List<LogEntry> logs;
  
  const ChatMessageList({super.key, required this.logs});

  @override
  State<ChatMessageList> createState() => _ChatMessageListState();
}

class _ChatMessageListState extends State<ChatMessageList> {
  final ScrollController _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
  }

  @override
  void didUpdateWidget(ChatMessageList oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.logs.length > oldWidget.logs.length) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
    }
  }

  void _scrollToBottom() {
    if (_scrollController.hasClients) {
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOutCubic,
      );
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      controller: _scrollController,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      itemCount: widget.logs.length,
      separatorBuilder: (context, index) => const SizedBox(height: 12),
      itemBuilder: (context, index) {
        final entry = widget.logs[index];
        final isUser = entry.message.startsWith('> Task:') || entry.message.startsWith('> Answer:');

        if (!isUser && entry.structuredType == 'reasoning') {
          return _ThinkingEventCard(entry: entry);
        }

        if (!isUser &&
            (entry.structuredType == 'step_start' ||
                entry.structuredType == 'step_finish')) {
          return _StepEventCard(entry: entry);
        }

        if (!isUser && entry.structuredType == 'tool_use') {
          return _StepEventCard(entry: entry, isToolEvent: true);
        }
        
        return Align(
          alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
          child: _AnimatedChatBubble(
            key: ValueKey(entry.id),
            entry: entry,
            isUser: isUser,
          ),
        );
      },
    );
  }
}

class _AnimatedChatBubble extends StatefulWidget {
  final LogEntry entry;
  final bool isUser;

  const _AnimatedChatBubble({
    Key? key,
    required this.entry,
    required this.isUser,
  }) : super(key: key);

  @override
  State<_AnimatedChatBubble> createState() => _AnimatedChatBubbleState();
}

class _AnimatedChatBubbleState extends State<_AnimatedChatBubble>
    with TickerProviderStateMixin, AutomaticKeepAliveClientMixin {
  late final AnimationController _controller;
  late final Animation<double> _scaleAnimation;
  late final Animation<Offset> _slideAnimation;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 350),
    );

    // Bouncy scale for that iOS SMS feel
    _scaleAnimation = CurvedAnimation(
      parent: _controller,
      curve: Curves.elasticOut,
    );

    // Slide up slightly
    _slideAnimation = Tween<Offset>(
      begin: const Offset(0.0, 0.2),
      end: Offset.zero,
    ).animate(CurvedAnimation(
      parent: _controller,
      curve: Curves.easeOutCubic,
    ));

    _controller.forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return FadeTransition(
      opacity: _controller,
      child: SlideTransition(
        position: _slideAnimation,
        child: ScaleTransition(
          scale: _scaleAnimation,
          alignment: widget.isUser ? Alignment.bottomRight : Alignment.bottomLeft,
          child: _ChatBubble(entry: widget.entry, isUser: widget.isUser),
        ),
      ),
    );
  }
}

class _ChatBubble extends StatelessWidget {
  final LogEntry entry;
  final bool isUser;

  const _ChatBubble({required this.entry, required this.isUser});

  @override
  Widget build(BuildContext context) {
    final cli = CliTheme.of(context);
    
    // Extract actual message if it's a user command
    String displayMessage = entry.message;
    if (isUser && displayMessage.startsWith('> Task: ')) {
      displayMessage = displayMessage.substring(8);
    } else if (isUser && displayMessage.startsWith('> Answer: ')) {
      displayMessage = displayMessage.substring(10);
    }

    // Determine bubble styling
    Color bgColor = isUser 
      ? cli.accentDim
      : Colors.grey.shade900;
    
    Color textColor = isUser
      ? Colors.white
      : Colors.white;

    if (entry.level == AgentLogLevel.error) {
      bgColor = cli.redMuted;
      textColor = cli.red;
    }

    IconData? leftIcon;
    if (!isUser) {
      if (entry.structuredType == 'text') {
        leftIcon = null;
      } else if (entry.level == AgentLogLevel.tool) {
        leftIcon = Icons.build_circle_outlined;
      } else if (entry.level == AgentLogLevel.error) {
        leftIcon = Icons.error_outline;
      } else if (entry.level == AgentLogLevel.warn) {
        leftIcon = Icons.warning_amber_rounded;
      } else if (entry.level == AgentLogLevel.info) {
        leftIcon = Icons.info_outline;
      }
    }

    return ConstrainedBox(
      constraints: BoxConstraints(
        maxWidth: MediaQuery.of(context).size.width * 0.8,
      ),
      child: Container(
        decoration: BoxDecoration(
          color: bgColor,
          border: isUser ? null : Border.all(
            color: Colors.grey.shade700,
            width: 1,
          ),
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(isUser ? 16 : 4),
            bottomRight: Radius.circular(isUser ? 4 : 16),
          ),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!isUser && leftIcon != null) ...[
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(leftIcon, size: 14, color: textColor.withValues(alpha: 0.7)),
                  const SizedBox(width: 6),
                  Text(
                    entry.toolName ?? (entry.level == AgentLogLevel.error ? 'Error' : 'Agent'),
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      color: textColor.withValues(alpha: 0.8),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
            ],
            Text(
              displayMessage,
              style: TextStyle(
                color: textColor,
                fontSize: 15,
                height: 1.3,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StepEventCard extends StatelessWidget {
  final LogEntry entry;
  final bool isToolEvent;

  const _StepEventCard({required this.entry, this.isToolEvent = false});

  @override
  Widget build(BuildContext context) {
    final cli = CliTheme.of(context);
    final isStart = entry.structuredType == 'step_start';

    final icon = isToolEvent
        ? Icons.build_circle_outlined
        : isStart
            ? Icons.play_arrow_rounded
            : Icons.check_circle_outline;

    final title = isToolEvent
        ? 'Tool Event'
        : isStart
            ? 'Step Started'
            : 'Step Completed';

    return Container(
      margin: const EdgeInsets.only(right: 36),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: cli.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: cli.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: cli.textDim),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: cli.mono.copyWith(
                    color: cli.textDim,
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 0.8,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  entry.message,
                  style: cli.mono.copyWith(
                    color: cli.text,
                    fontSize: 12,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ThinkingEventCard extends StatelessWidget {
  final LogEntry entry;

  const _ThinkingEventCard({required this.entry});

  @override
  Widget build(BuildContext context) {
    final cli = CliTheme.of(context);
    final text = entry.message.trim();
    final preview = text.length > 90 ? '${text.substring(0, 90)}...' : text;

    return Container(
      margin: const EdgeInsets.only(right: 24),
      decoration: BoxDecoration(
        color: cli.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: cli.border),
      ),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
          childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
          collapsedIconColor: cli.textDim,
          iconColor: cli.accent,
          title: Row(
            children: [
              Icon(Icons.psychology_alt_outlined, size: 16, color: cli.textDim),
              const SizedBox(width: 8),
              Text(
                'Thinking',
                style: cli.mono.copyWith(
                  color: cli.textDim,
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 0.8,
                ),
              ),
            ],
          ),
          subtitle: Text(
            preview,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: cli.mono.copyWith(
              color: cli.textDim,
              fontSize: 11,
            ),
          ),
          children: [
            _TypewriterText(
              text: text,
              style: cli.mono.copyWith(
                color: cli.text,
                fontSize: 12,
                height: 1.35,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TypewriterText extends StatelessWidget {
  final String text;
  final TextStyle? style;

  const _TypewriterText({required this.text, this.style});

  @override
  Widget build(BuildContext context) {
    final durationMs = (text.length * 14).clamp(300, 1800);
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: Duration(milliseconds: durationMs),
      curve: Curves.easeOut,
      builder: (context, value, _) {
        final visible = (text.length * value).floor().clamp(0, text.length);
        final current = text.substring(0, visible);
        return Text(current, style: style);
      },
    );
  }
}

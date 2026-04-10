/// Pairing screen — QR scan + manual entry.

import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../providers/connection_provider.dart';
import '../services/socket_service.dart';
import '../utils/device_id.dart';

class PairScreen extends ConsumerStatefulWidget {
  const PairScreen({super.key});

  @override
  ConsumerState<PairScreen> createState() => _PairScreenState();
}

class _PairScreenState extends ConsumerState<PairScreen> {
  bool _manualMode = false;
  bool _isConnecting = false;
  final _deviceIdController = TextEditingController();
  final _urlController = TextEditingController(text: 'wss://signal.codetwin.dev');
  final _formKey = GlobalKey<FormState>();
  final _deviceIdPattern = RegExp(r'^[0-9a-f]{12}$');

  @override
  void dispose() {
    _deviceIdController.dispose();
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _pair(String deviceId, String signalingUrl) async {
    setState(() => _isConnecting = true);

    await savePairing(deviceId, signalingUrl);
    ref.read(connectionProvider.notifier).initFromPairing(
          deviceId,
          signalingUrl,
        );
    SocketService().connect(signalingUrl, deviceId);

    if (mounted) {
      context.go('/dashboard');
    }
  }

  void _onQrDetect(BarcodeCapture capture) {
    for (final barcode in capture.barcodes) {
      final raw = barcode.rawValue;
      if (raw == null) continue;
      try {
        final json = jsonDecode(raw) as Map<String, dynamic>;
        final deviceId = json['deviceId'] as String?;
        final signalingUrl = json['signalingUrl'] as String?;
        if (deviceId != null && signalingUrl != null) {
          _pair(deviceId, signalingUrl);
          return;
        }
      } catch (_) {
        // Not a valid CodeTwin QR — ignore
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final primaryColor = const Color(0xFF20B2AA);

    return Theme(
      data: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: Colors.black,
        colorScheme: ColorScheme.dark(
          primary: primaryColor,
          onPrimary: Colors.white,
          surface: Colors.black,
        ),
      ),
      child: Scaffold(
        backgroundColor: Colors.black,
        body: Stack(
          children: [
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const SizedBox(height: 16),
                    // Titles
                    Text(
                      'DEVICE PAIRING',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: primaryColor,
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 2.0,
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Connect to CodeTwin',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 28,
                        fontWeight: FontWeight.w300,
                        letterSpacing: 1.2,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Scan the QR code shown by the CLI or enter pairing info manually.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white.withOpacity(0.5),
                        fontSize: 13,
                        letterSpacing: 0.5,
                      ),
                    ),
                    const SizedBox(height: 48),

                    // Main Content
                    Expanded(
                      child: AnimatedSwitcher(
                        duration: const Duration(milliseconds: 500),
                        switchInCurve: Curves.easeOutExpo,
                        switchOutCurve: Curves.easeInExpo,
                        child: _isConnecting
                            ? _buildConnectingState(primaryColor)
                            : (_manualMode
                                ? _buildManualForm(primaryColor)
                                : _buildQrScanner(primaryColor)),
                      ),
                    ),
                    
                    const SizedBox(height: 24),
                    
                    // Toggle Mode Button
                    if (!_isConnecting)
                      Center(
                        child: TextButton(
                          onPressed: () => setState(() => _manualMode = !_manualMode),
                          style: TextButton.styleFrom(
                            foregroundColor: primaryColor,
                            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(30),
                              side: BorderSide(color: primaryColor.withOpacity(0.3)),
                            ),
                          ),
                          child: Text(
                            _manualMode ? 'USE QR SCANNER' : 'ENTER MANUALLY',
                            style: const TextStyle(
                              fontSize: 12,
                              letterSpacing: 1.5,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ),
                    
                    if (!_isConnecting)
                      Center(
                        child: TextButton(
                          onPressed: () {
                            // Dev bypass: Use a fake device ID and go to dashboard
                            _deviceIdController.text = '0123456789ab';
                            _pair(_deviceIdController.text, _urlController.text);
                          },
                          style: TextButton.styleFrom(
                            foregroundColor: Colors.amber, // Give it a distinct color
                          ),
                          child: const Text(
                            'DEV BYPASS',
                            style: TextStyle(
                              fontSize: 10,
                              letterSpacing: 1.5,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildConnectingState(Color primaryColor) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        SizedBox(
          width: 200,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              backgroundColor: primaryColor.withOpacity(0.1),
              valueColor: AlwaysStoppedAnimation<Color>(primaryColor),
              minHeight: 2,
            ),
          ),
        ),
        const SizedBox(height: 24),
        Text(
          'CONNECTING...',
          style: TextStyle(
            color: primaryColor,
            fontSize: 14,
            letterSpacing: 2.0,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          'Authenticating with server',
          style: TextStyle(
            color: Colors.white.withOpacity(0.4),
            fontSize: 12,
          ),
        ),
      ],
    );
  }

  Widget _buildQrScanner(Color primaryColor) {
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: primaryColor.withValues(alpha: 0.3), width: 1.5),
        boxShadow: [
          BoxShadow(
            color: primaryColor.withValues(alpha: 0.05),
            blurRadius: 20,
            spreadRadius: 5,
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(24),
        child: Stack(
          alignment: Alignment.center,
          fit: StackFit.expand,
          children: [
            MobileScanner(onDetect: _onQrDetect),
            Center(
              child: SizedBox(
                width: 220,
                height: 220,
                child: Stack(
                  children: [
                    CustomPaint(
                      size: const Size(220, 220),
                      painter: _ScannerOverlayPainter(color: primaryColor),
                    ),
                    _AnimatedScannerLaser(color: primaryColor),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildManualForm(Color primaryColor) {
    return SingleChildScrollView(
      child: Form(
        key: _formKey,
        child: Column(
          children: [
            _buildAiInputField(
              controller: _deviceIdController,
              label: 'DEVICE ID',
              icon: Icons.fingerprint,
              validator: (v) {
                if (v == null || !_deviceIdPattern.hasMatch(v)) {
                  return 'Must be a 12-character hex string';
                }
                return null;
              },
              primaryColor: primaryColor,
            ),
            const SizedBox(height: 24),
            _buildAiInputField(
              controller: _urlController,
              label: 'SIGNALING URL',
              icon: Icons.cloud_outlined,
              validator: (v) {
                if (v == null || v.isEmpty) return 'URL required';
                final uri = Uri.tryParse(v);
                if (uri == null || !uri.hasScheme) return 'Invalid URL';
                return null;
              },
              primaryColor: primaryColor,
            ),
            const SizedBox(height: 40),
            // Glowing submit button
            Container(
              width: double.infinity,
              height: 56,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                boxShadow: [
                  BoxShadow(
                    color: primaryColor.withOpacity(0.4),
                    blurRadius: 20,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: FilledButton(
                onPressed: () {
                  if (_formKey.currentState!.validate()) {
                    _pair(
                      _deviceIdController.text.trim(),
                      _urlController.text.trim(),
                    );
                  }
                },
                style: FilledButton.styleFrom(
                  backgroundColor: primaryColor,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
                child: const Text(
                  'CONNECT',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 2.0,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAiInputField({
    required TextEditingController controller,
    required String label,
    required IconData icon,
    required String? Function(String?) validator,
    required Color primaryColor,
  }) {
    return TextFormField(
      controller: controller,
      style: const TextStyle(color: Colors.white, fontSize: 16, letterSpacing: 1.5),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: TextStyle(color: primaryColor.withOpacity(0.8), letterSpacing: 2.0, fontSize: 12),
        prefixIcon: Icon(icon, color: primaryColor.withOpacity(0.8)),
        filled: true,
        fillColor: primaryColor.withOpacity(0.05),
        errorStyle: const TextStyle(color: Colors.redAccent, letterSpacing: 1.0, fontSize: 10),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: primaryColor.withOpacity(0.2), width: 1.5),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: primaryColor, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: Colors.redAccent.withOpacity(0.5), width: 1.5),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: Colors.redAccent, width: 2),
        ),
        contentPadding: const EdgeInsets.symmetric(vertical: 20),
      ),
      validator: validator,
    );
  }
}

class _ScannerOverlayPainter extends CustomPainter {
  final Color color;
  _ScannerOverlayPainter({required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 3.0
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    final double cornerLength = 30.0;
    
    // Top Left
    canvas.drawLine(const Offset(0, 0), Offset(cornerLength, 0), paint);
    canvas.drawLine(const Offset(0, 0), Offset(0, cornerLength), paint);
    
    // Top Right
    canvas.drawLine(Offset(size.width, 0), Offset(size.width - cornerLength, 0), paint);
    canvas.drawLine(Offset(size.width, 0), Offset(size.width, cornerLength), paint);

    // Bottom Left
    canvas.drawLine(Offset(0, size.height), Offset(cornerLength, size.height), paint);
    canvas.drawLine(Offset(0, size.height), Offset(0, size.height - cornerLength), paint);

    // Bottom Right
    canvas.drawLine(Offset(size.width, size.height), Offset(size.width - cornerLength, size.height), paint);
    canvas.drawLine(Offset(size.width, size.height), Offset(size.width, size.height - cornerLength), paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _AnimatedScannerLaser extends StatefulWidget {
  final Color color;
  const _AnimatedScannerLaser({required this.color});

  @override
  State<_AnimatedScannerLaser> createState() => _AnimatedScannerLaserState();
}

class _AnimatedScannerLaserState extends State<_AnimatedScannerLaser>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat(reverse: true);
    
    _animation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOutSine),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _animation,
      builder: (context, child) {
        return Positioned(
          top: 10 + (_animation.value * 198), // 220 box size - margins
          left: 20,
          right: 20,
          child: Container(
            height: 2,
            decoration: BoxDecoration(
              color: widget.color.withValues(alpha: 0.8),
              boxShadow: [
                BoxShadow(
                  color: widget.color,
                  blurRadius: 10,
                  spreadRadius: 2,
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

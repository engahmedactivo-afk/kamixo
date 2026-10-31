import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../api/models.dart';

/// Full-screen vertical video player for one episode.
///
/// Built by a PageView with `allowImplicitScrolling`, so the neighbouring pages are
/// constructed (and their video initialized/buffered) before the user swipes to them.
/// Only the [active] page plays.
class EpisodePlayer extends StatefulWidget {
  final Playback playback;
  final bool active;
  final bool loop;
  final Duration startAt;
  final String captionLang;
  final VoidCallback? onCompleted;
  final ValueChanged<Duration>? onProgress;

  const EpisodePlayer({
    super.key,
    required this.playback,
    required this.active,
    this.loop = false,
    this.startAt = Duration.zero,
    this.captionLang = 'en',
    this.onCompleted,
    this.onProgress,
  });

  @override
  State<EpisodePlayer> createState() => _EpisodePlayerState();
}

class _EpisodePlayerState extends State<EpisodePlayer> {
  late VideoPlayerController _controller;
  bool _completedFired = false;
  bool _userPaused = false;
  Duration _lastReported = Duration.zero;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _create();
  }

  Future<ClosedCaptionFile>? _captions() {
    final subs = widget.playback.subtitles;
    final url = subs[widget.captionLang] ?? subs['en'] ?? (subs.isEmpty ? null : subs.values.first);
    if (url == null) return null;
    return Dio()
        .get<String>(url, options: Options(responseType: ResponseType.plain))
        .then<ClosedCaptionFile>((r) => WebVTTCaptionFile(r.data ?? 'WEBVTT'))
        .catchError((_) => WebVTTCaptionFile('WEBVTT'));
  }

  void _create() {
    _completedFired = false;
    _error = null;
    _controller = VideoPlayerController.networkUrl(Uri.parse(widget.playback.url), closedCaptionFile: _captions())
      ..addListener(_onTick);
    _controller.setLooping(widget.loop);
    _controller.initialize().then((_) async {
      if (!mounted) return;
      if (widget.startAt > Duration.zero) await _controller.seekTo(widget.startAt);
      if (widget.active) await _controller.play();
      if (mounted) setState(() {});
    }).catchError((Object e) {
      if (mounted) setState(() => _error = e);
    });
  }

  void _onTick() {
    final v = _controller.value;
    if (!v.isInitialized) return;
    if ((v.position - _lastReported).inSeconds.abs() >= 5) {
      _lastReported = v.position;
      widget.onProgress?.call(v.position);
    }
    final ended = v.duration > Duration.zero && v.position >= v.duration - const Duration(milliseconds: 300);
    if (ended && !v.isPlaying && !widget.loop && !_completedFired) {
      _completedFired = true;
      widget.onProgress?.call(v.position);
      widget.onCompleted?.call();
    }
    if (mounted) setState(() {});
  }

  @override
  void didUpdateWidget(EpisodePlayer old) {
    super.didUpdateWidget(old);
    if (old.playback.url != widget.playback.url) {
      _controller.removeListener(_onTick);
      _controller.dispose();
      _create();
      return;
    }
    if (old.active != widget.active && _controller.value.isInitialized) {
      if (widget.active && !_userPaused) {
        _controller.play();
      } else if (!widget.active) {
        widget.onProgress?.call(_controller.value.position);
        _controller.pause();
      }
    }
  }

  @override
  void dispose() {
    _controller.removeListener(_onTick);
    _controller.dispose();
    super.dispose();
  }

  void _togglePause() {
    if (!_controller.value.isInitialized) return;
    setState(() {
      _userPaused = _controller.value.isPlaying;
      _userPaused ? _controller.pause() : _controller.play();
    });
  }

  @override
  Widget build(BuildContext context) {
    final v = _controller.value;
    if (_error != null) {
      return const Center(child: Text('Could not load this video', style: TextStyle(color: Colors.white70)));
    }
    return GestureDetector(
      onTap: _togglePause,
      child: Stack(fit: StackFit.expand, children: [
        const ColoredBox(color: Colors.black),
        if (v.isInitialized)
          FittedBox(
            fit: v.aspectRatio < 1 ? BoxFit.cover : BoxFit.contain,
            clipBehavior: Clip.hardEdge,
            child: SizedBox(width: v.size.width, height: v.size.height, child: VideoPlayer(_controller)),
          )
        else
          const Center(child: CircularProgressIndicator()),
        Positioned(
          left: 16,
          right: 16,
          bottom: 130,
          child: ClosedCaption(text: v.caption.text, textStyle: const TextStyle(fontSize: 17, color: Colors.white)),
        ),
        if (v.isInitialized && !v.isPlaying && _userPaused)
          const Center(child: Icon(Icons.play_arrow_rounded, size: 84, color: Colors.white70)),
        if (v.isInitialized)
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: VideoProgressIndicator(_controller,
                allowScrubbing: true,
                padding: const EdgeInsets.only(top: 12),
                colors: VideoProgressColors(playedColor: Theme.of(context).colorScheme.primary)),
          ),
      ]),
    );
  }
}

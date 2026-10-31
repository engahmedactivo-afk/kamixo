import 'package:flutter/material.dart';

class SeriesCard extends StatelessWidget {
  final String title;
  final String coverUrl;
  final String? subtitle;
  final VoidCallback onTap;

  const SeriesCard({super.key, required this.title, required this.coverUrl, this.subtitle, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        AspectRatio(
          aspectRatio: 9 / 16,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Image.network(coverUrl,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => Container(color: Colors.white10, child: const Icon(Icons.movie))),
          ),
        ),
        const SizedBox(height: 6),
        Text(title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
        if (subtitle != null) Text(subtitle!, style: const TextStyle(fontSize: 12, color: Colors.white60)),
      ]),
    );
  }
}

# FFmpeg MCP Server

A Model Context Protocol (MCP) server that provides tools for video and audio processing using FFmpeg.

## Features

The FFmpeg MCP Server provides the following capabilities:

- **Video Trimming**: Cut a video file to a specified segment.
- **Frame Extraction**: Extract a still image from a video at a specific timestamp.
- **Audio Segmentation**: Split audio files into segments with configurable overlap (useful for processing large audio files).

## Requirements

- Node.js 18 or higher
- FFmpeg installed and available in the system PATH

## Installation

1. Clone this repository:
```
git clone https://github.com/mfleurival/FFmpeg.git
cd FFmpeg
```

2. Install dependencies:
```
npm install
```

3. Build the project:
```
npm run build
```

## Usage

### Running the Server

To start the server:

```
npm start
```

### Available Tools

#### 1. trim_video

Trim a video to specified start and end times.

Parameters:
- `video_path`: Path to the input video file
- `start_time`: Start time in format HH:MM:SS
- `end_time`: End time in format HH:MM:SS
- `output_format` (optional): Output format (e.g., mp4, mkv) - defaults to mp4

#### 2. extract_frame

Extract a frame from a video at a specified timestamp.

Parameters:
- `video_path`: Path to the input video file
- `timestamp`: Time to extract frame in format HH:MM:SS
- `output_format` (optional): Output image format (png, jpg) - defaults to png

#### 3. segment_audio

Split audio into segments with configurable overlap.

Parameters:
- `audio_path`: Path to input audio file
- `segment_duration`: Duration of each segment in seconds
- `overlap_duration` (optional): Overlap duration in seconds - defaults to 2
- `output_format` (optional): Output format (wav, mp3) - defaults to wav
- `output_directory`: Directory to save segments
- `naming_pattern` (optional): Pattern for segment filenames - defaults to "segment_{number}"

## Integration with Cline

This server can be integrated with Claude/Cline by adding it to your MCP settings configuration file. Add the following configuration:

```json
{
  "mcpServers": {
    "ffmpeg": {
      "command": "node",
      "args": ["/path/to/FFmpeg/build/index.js"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

## License

ISC

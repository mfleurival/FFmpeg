#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import ffmpeg from 'fluent-ffmpeg';
import { promises as fs } from 'fs';
import path from 'path';

interface SegmentConfig {
  startTime: number;
  endTime: number;
  overlapStart: number;
  overlapEnd: number;
  filename: string;
}

class FFmpegServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'ffmpeg-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'trim_video',
          description: 'Trim video to specified duration',
          inputSchema: {
            type: 'object',
            properties: {
              video_path: {
                type: 'string',
                description: 'Path to input video file',
              },
              start_time: {
                type: 'string',
                description: 'Start time (HH:MM:SS)',
              },
              end_time: {
                type: 'string',
                description: 'End time (HH:MM:SS)',
              },
              output_format: {
                type: 'string',
                description: 'Output format (e.g., mp4, mkv)',
                default: 'mp4',
              },
            },
            required: ['video_path', 'start_time', 'end_time'],
          },
        },
        {
          name: 'extract_frame',
          description: 'Extract a frame from video at specified timestamp',
          inputSchema: {
            type: 'object',
            properties: {
              video_path: {
                type: 'string',
                description: 'Path to input video file',
              },
              timestamp: {
                type: 'string',
                description: 'Timestamp to extract frame (HH:MM:SS)',
              },
              output_format: {
                type: 'string',
                description: 'Output image format (png, jpg)',
                default: 'png',
              },
            },
            required: ['video_path', 'timestamp'],
          },
        },
        {
          name: 'segment_audio',
          description: 'Split audio into segments with overlap',
          inputSchema: {
            type: 'object',
            properties: {
              audio_path: {
                type: 'string',
                description: 'Path to input audio file',
              },
              segment_duration: {
                type: 'number',
                description: 'Duration of each segment in seconds',
              },
              overlap_duration: {
                type: 'number',
                description: 'Overlap duration in seconds',
                default: 2,
              },
              output_format: {
                type: 'string',
                description: 'Output format (wav, mp3)',
                default: 'wav',
              },
              output_directory: {
                type: 'string',
                description: 'Directory to save segments',
              },
              naming_pattern: {
                type: 'string',
                description: 'Pattern for segment filenames',
                default: 'segment_{number}',
              },
            },
            required: ['audio_path', 'segment_duration', 'output_directory'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case 'trim_video':
          return await this.handleTrimVideo(request.params.arguments);
        case 'extract_frame':
          return await this.handleExtractFrame(request.params.arguments);
        case 'segment_audio':
          return await this.handleSegmentAudio(request.params.arguments);
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  private async handleTrimVideo(args: any) {
    const { video_path, start_time, end_time, output_format = 'mp4' } = args;
    
    if (!await this.fileExists(video_path)) {
      throw new McpError(ErrorCode.InvalidRequest, `Video file not found: ${video_path}`);
    }

    const outputPath = path.join(
      path.dirname(video_path),
      `${path.basename(video_path, path.extname(video_path))}_trimmed.${output_format}`
    );

    await new Promise((resolve, reject) => {
      ffmpeg(video_path)
        .setStartTime(start_time)
        .setDuration(this.getTimeDifference(start_time, end_time))
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    return {
      content: [
        {
          type: 'text',
          text: `Video trimmed successfully: ${outputPath}`,
        },
      ],
    };
  }

  private async handleExtractFrame(args: any) {
    const { video_path, timestamp, output_format = 'png' } = args;

    if (!await this.fileExists(video_path)) {
      throw new McpError(ErrorCode.InvalidRequest, `Video file not found: ${video_path}`);
    }

    const outputPath = path.join(
      path.dirname(video_path),
      `${path.basename(video_path, path.extname(video_path))}_frame_${timestamp.replace(/:/g, '_')}.${output_format}`
    );

    await new Promise((resolve, reject) => {
      ffmpeg(video_path)
        .screenshots({
          timestamps: [this.timestampToSeconds(timestamp)],
          filename: path.basename(outputPath),
          folder: path.dirname(outputPath),
        })
        .on('end', resolve)
        .on('error', reject);
    });

    return {
      content: [
        {
          type: 'text',
          text: `Frame extracted successfully: ${outputPath}`,
        },
      ],
    };
  }

  private async handleSegmentAudio(args: any) {
    const {
      audio_path,
      segment_duration,
      overlap_duration = 2,
      output_format = 'wav',
      output_directory,
      naming_pattern = 'segment_{number}',
    } = args;

    if (!await this.fileExists(audio_path)) {
      throw new McpError(ErrorCode.InvalidRequest, `Audio file not found: ${audio_path}`);
    }

    await fs.mkdir(output_directory, { recursive: true });

    const duration = await this.getAudioDuration(audio_path);
    const segments = this.calculateSegments(duration, segment_duration, overlap_duration);

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const segmentPath = path.join(
        output_directory,
        `${naming_pattern.replace('{number}', String(i + 1).padStart(3, '0'))}.${output_format}`
      );

      await new Promise((resolve, reject) => {
        ffmpeg(audio_path)
          .setStartTime(segment.startTime)
          .setDuration(segment.endTime - segment.startTime)
          .output(segmentPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
    }

    // Create metadata file
    const metadataPath = path.join(output_directory, 'segments_metadata.json');
    await fs.writeFile(
      metadataPath,
      JSON.stringify({
        original_file: audio_path,
        segment_duration,
        overlap_duration,
        total_duration: duration,
        segment_count: segments.length,
        segments: segments.map((s, i) => ({
          filename: `${naming_pattern.replace('{number}', String(i + 1).padStart(3, '0'))}.${output_format}`,
          start: s.startTime,
          end: s.endTime,
          overlap_start: s.overlapStart,
          overlap_end: s.overlapEnd,
        })),
      }, null, 2)
    );

    return {
      content: [
        {
          type: 'text',
          text: `Audio segmented successfully:\nTotal segments: ${segments.length}\nOutput directory: ${output_directory}\nMetadata file: ${metadataPath}`,
        },
      ],
    };
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private getTimeDifference(start: string, end: string): number {
    return this.timestampToSeconds(end) - this.timestampToSeconds(start);
  }

  private timestampToSeconds(timestamp: string): number {
    const [hours, minutes, seconds] = timestamp.split(':').map(Number);
    return hours * 3600 + minutes * 60 + seconds;
  }

  private async getAudioDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) reject(err);
        else resolve(metadata.format.duration || 0);
      });
    });
  }

  private calculateSegments(
    totalDuration: number,
    segmentDuration: number,
    overlapDuration: number
  ): SegmentConfig[] {
    const segments: SegmentConfig[] = [];
    let currentTime = 0;

    while (currentTime < totalDuration) {
      const endTime = Math.min(currentTime + segmentDuration, totalDuration);
      const overlapStart = Math.max(0, currentTime - overlapDuration);
      const overlapEnd = Math.min(totalDuration, endTime + overlapDuration);

      segments.push({
        startTime: currentTime,
        endTime,
        overlapStart,
        overlapEnd,
        filename: '', // Will be set when creating the file
      });

      currentTime = endTime;
    }

    return segments;
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('FFmpeg MCP server running on stdio');
  }
}

const server = new FFmpegServer();
server.run().catch(console.error);

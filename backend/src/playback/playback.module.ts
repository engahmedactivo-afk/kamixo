import { Controller, Get, Module, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser, UserAuthGuard } from '../auth/auth.guards';
import { PlaybackService } from './playback.service';

@Controller('episodes')
@UseGuards(UserAuthGuard)
export class PlaybackController {
  constructor(private readonly playback: PlaybackService) {}

  @Get(':id/playback')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.playback.getPlayback(user.id, id);
  }
}

@Module({
  controllers: [PlaybackController],
  providers: [PlaybackService],
  exports: [PlaybackService],
})
export class PlaybackModule {}

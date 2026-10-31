import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateGroupDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  title: string;

  /** Members to add alongside the creator. Creator is added automatically. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(49)
  @IsUUID('4', { each: true })
  memberIds: string[];
}

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  avatarUrl?: string;
}

export class AddMembersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(49)
  @IsUUID('4', { each: true })
  userIds: string[];
}

export class MuteConversationDto {
  @IsOptional()
  muted?: boolean;
}

export class StartDirectDto {
  @IsUUID('4')
  userId: string;
}

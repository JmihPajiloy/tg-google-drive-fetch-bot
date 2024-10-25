import type { FileConfig } from "./drive-file";
import { DriveFile } from "./drive-file";
import type { Observable, Observer, Subscription } from "rxjs";
import { map } from "rxjs";
import { tap } from "rxjs";
import {
  catchError,
  distinct,
  filter,
  from,
  interval,
  mergeMap,
  of,
  retry,
  share,
  throwError,
  timer,
} from "rxjs";
import { GrammyError, HttpError } from "grammy";
import { logger } from "../logger";

export const DRIVE_FOLDER_LINK_REGEX = /^https:\/\/drive.google.com\/drive\/folders\/([A-Za-z0-9_-]+)\??.*$/g;

export type FolderConfig = {
  kind: "drive#fileList";
  incompleteSearch: boolean;
  files: FileConfig[];
};

export type ForumTopic = {
  chat: number;
  topic: number;
};

export type DriveObserver = Partial<Observer<DriveFile>>;

export class DriveStream {
  private static readonly instances = new Map<string, DriveStream>();

  private readonly source: string;
  private readonly observable: Observable<DriveFile>;
  private subscriptions: Subscription[];
  private readonly forumTopic: ForumTopic;

  private constructor(forumTopic: ForumTopic, source: string, after?: Date) {
    this.source = source;
    this.forumTopic = forumTopic;
    this.observable = interval(10_000).pipe(
      tap(() => logger.info(`Attempting to access "${source}"...`)),
      mergeMap(() => from(DriveFile.getFiles(source, after))),
      tap<DriveFile[]>(lst => logger.info(`Successfully fetched ${lst.length} files`)),
      mergeMap(files => from(files)),
      distinct(file => file.md5),
      tap<DriveFile>(file => logger.info(`Found new file - "${file.fullname}"`)),
      map(x => x),
      catchError((e) => {
        if ((e instanceof GrammyError && e.error_code === 429) || (e instanceof HttpError)) {
          logger.warn(`An error occurred while sending request: ${e.name}: ${e.message}`);
          return timer(15000).pipe(
            mergeMap(() => throwError(() => e)),
          );
        }
        logger.crit(`An unexpected error while sending request:`, e);
        return of<number>(-1);
      }),
      filter<DriveFile | number, DriveFile>(x => x instanceof DriveFile),
      retry<DriveFile>(),
      share<DriveFile>(),
    ) as Observable<DriveFile>;
    this.subscriptions = [];
  }

  private static hash({ topic, chat }: ForumTopic, source: string): string {
    return `${topic}_${chat}_${source}`;
  }

  public static getByID(forumTopic: ForumTopic, source: string, after?: Date): DriveStream {
    const key = this.hash(forumTopic, source);
    if (!this.instances.has(key)) {
      this.instances.set(key, new DriveStream(forumTopic, source, after));
    }
    return this.instances.get(key) as DriveStream;
  }

  public static getByLink(url: string, forumTopic: ForumTopic, after?: Date): DriveStream {
    const matched = DRIVE_FOLDER_LINK_REGEX.exec(url);
    if (!matched) {
      throw new Error(`URL "${url}" doesn't satisfies the format!`);
    }
    return this.getByID(forumTopic, matched[1], after);
  }

  public watch() {
    return this.observable;
  }

  public get link(): string {
    return `https://drive.google.com/drive/folders/${this.source}`;
  }

  public subscribe(callback: ({ chat, topic }: ForumTopic, source: string) => (file: DriveFile) => Promise<void>): void {
    const sub: Subscription = this.observable
      .subscribe(callback(this.forumTopic, this.source));
    this.subscriptions.push(sub);
  }

  public unsubscribe(): void {
    this.subscriptions
      .forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
    DriveStream.instances.delete(DriveStream.hash(this.forumTopic, this.source));
  }
}

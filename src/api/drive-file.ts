import type { AxiosResponse } from "axios";
import axios from "axios";
import { InputFile } from "grammy";
import type { FolderConfig } from "./drive-stream";
import { API_KEY } from "../bot";
import { getAuthor } from "../utils";

export type FileConfig = {
  kind: "drive#file";
  mimeType: string;
  owners: {
    kind: "drive#user";
    displayName: string;
    photoLink: string;
    me: boolean;
    permissionId: string;
    emailAddress: string;
  }[];
  id: string;
  name: string;
  fileExtension: string;
  md5Checksum: string;
  webContentLink: string;
  webViewLink: string;
  originalFilename: string;
  fullFileExtension: string;
  hasThumbnail: boolean;
  createdTime: string;
};

export class DriveFile {
  public readonly name: string;
  public readonly extension: string;
  public readonly fullname: string;
  public readonly webview: string;
  public readonly link: string;
  public readonly createdAt: string;
  public readonly md5: string;
  public readonly owner: string;
  private readonly id: string;

  public constructor(props: FileConfig) {
    this.name = props.originalFilename;
    this.extension = props.fullFileExtension;
    this.fullname = props.name;
    this.id = props.id;
    this.owner = props.owners[0].emailAddress;
    this.md5 = props.md5Checksum;
    this.webview = props.webViewLink;
    this.link = props.webContentLink;
    this.createdAt = props.createdTime;
  }

  public static async getFiles(folderID: string, after?: Date): Promise<DriveFile[]> {
    const query = after
      ? `'${folderID}' in parents and createdTime > '${after.toISOString().slice(0, 19)}'`
      : `'${folderID}' in parents`;
    const response: AxiosResponse<FolderConfig> = await axios.get(`https://www.googleapis.com/drive/v3/files`, {
      params: {
        q: query,
        orderBy: "createdTime",
        key: API_KEY,
        fields: "*",
      },
    });
    return response.data.files.map(raw => new DriveFile(raw));
  }

  public async download(filename?: string): Promise<InputFile> {
    const response = await axios.get(
      `https://www.googleapis.com/drive/v3/files/${this.id}`,
      {
        responseType: "arraybuffer",
        params: {
          alt: "media",
          key: API_KEY,
        },
      },
    );
    return new InputFile(Buffer.from(response.data, "utf8"), filename ?? this.fullname);
  }
}

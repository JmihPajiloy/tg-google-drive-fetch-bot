import { createLogger, format, transports } from "winston";

export const logger = createLogger({
  format: format.combine(
    format.prettyPrint({ colorize: true }),
    format.colorize({
      level: true,
    }),
    format.cli(),
  ),
  transports: [new transports.Console()],
});

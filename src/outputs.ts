import * as core from '@actions/core';
import path from 'path';
import {createWriteStream, fstat, promises} from 'fs';
import {Logger} from './logger';
import {Settings} from './setup';
import { resolveEnvVars } from './utils';

export interface OutputAction {
  type: string;
  invoke: (
    yaml: string,
    errors: string[],
    settings: Settings,
    logger: Logger
  ) => Promise<void>;
}

export class LoggerOutputAction implements OutputAction {
  type: string = 'LoggerOutputAction';
  logErrors: boolean = true;
  logYaml: boolean = true;
  invoke(yaml: string, errors: string[], settings: Settings, logger: Logger) {
    if (this.logYaml) {
      logger.log(yaml);
    }
    if (this.logErrors) {
      errors.forEach(logger.error);
    }
    return Promise.resolve();
  }
}

export class VariableOutputAction implements OutputAction {
  type: string = 'VariableOutputAction';
  outputVariableName: string | undefined = 'output';
  errorsVariableName: string | undefined = 'errors';

  invoke(yaml: string, errors: string[], settings: Settings, logger: Logger) {
    if (this.outputVariableName) {
      core.exportVariable(this.outputVariableName, yaml);
      if (settings.verbose) {
        logger.log(`Wrote ${yaml.length} chars to ${this.outputVariableName}`);
      }
    }
    if (this.errorsVariableName) {
      core.exportVariable(this.errorsVariableName, errors);
      if (settings.verbose) {
        logger.log(
          `Wrote ${errors.length} errors to ${this.errorsVariableName}`
        );
      }
    }
    return Promise.resolve();
  }
}

export class FileOutputAction implements OutputAction {
  type: string = 'FileOutputAction';
  fileName!: string;
  createDirIfMissing: boolean = true;
  fileOpenFlags: string = 'w';
  dontOutputIfErrored: boolean = true;
  invoke(yaml: string, errors: string[], settings: Settings, logger: Logger) {
    return new Promise<void>((res, rej) => {
      if (this.dontOutputIfErrored && errors.length) {
        return res();
      }
      const fileName = resolveEnvVars(this.fileName);
      const writeToFile = () => {
        const str = createWriteStream(fileName, {
          flags: this.fileOpenFlags
        });
        str.on('error', rej);
        str.write(yaml, err => (err ? rej(err) : str.end(res)));
      };
      if (this.createDirIfMissing) {
        promises
          .mkdir(path.dirname(fileName), {recursive: true})
          .catch(rej)
          .then(writeToFile);
      } else {
        writeToFile();
      }

      if (settings.verbose) {
        logger.log(`Wrote ${yaml.length} chars to file ${fileName}`);
      }
    });
  }
}

export const runActions = async (
  yaml: string,
  errors: string[],
  settings: Settings,
  logger: Logger
) => {
  const actions = settings.outputActions || [];
  for (let i = 0; i < actions.length; i++) {
    await actions[i].invoke(yaml, errors, settings, logger);
  }
};

export const parseActions = (
  json: string,
  typeMappings?: any
): OutputAction[] => {
  const types = typeMappings || {
    LoggerOutputAction: LoggerOutputAction,
    VariableOutputAction: VariableOutputAction,
    FileOutputAction: FileOutputAction
  };
  const actions: Array<OutputAction> = JSON.parse(json).map((i: any) => {
    if (Object.keys(types).indexOf(i.type) === -1) {
      throw new Error('cant find output action ' + i.type);
    }

    const target: any = new types[i.type]();
    for (const key in i) {
      target[key] = i[key];
    }
    return target;
  });
  return actions;
};
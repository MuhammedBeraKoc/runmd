#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const minimist = require('minimist');
const path = require('path');
const requireLike = require('require-like');
const stream = require('stream');
const util = require('util');
const vm = require('vm');

const LINK = '[![RunMD Logo](http://i.imgur.com/h0FVyzU.png)](https://github.com/broofa/runmd)';

const argv = minimist(process.argv.slice(2));

class Renderer {
  constructor(inputFile, outputFile) {
    this.inputFile = path.resolve(process.cwd(), inputFile);
    if (outputFile) {
      if (!/\.md$/.test(outputFile)) throw new Error(
        `Output file ${outputFile} must have .md extension`);

      this.outputFile = outputFile && path.resolve(process.cwd(), outputFile);
      this.pathTo = path.relative(path.dirname(this.outputFile), this.inputFile);
    }
  }

  render(options) {
    let hide = false;
    let transformLine = false;
    const context = {};
    let inputFile = this.inputFile;
    let contexts = {};
    const outputLines = [];

    function write(...args) {
      if (!hide) outputLines.push(args.join(' '));
    }

    function getContext(name) {
      transformLine = false;

      if (name && contexts[name]) {
        return contexts[name];
      }

      const context = vm.createContext({
        console: {
          isRunmd: true,
          log: function(...args) {
            args = args.map(arg => typeof(arg) == 'string' ? arg: util.inspect(arg));
            let _out = args.join(' ').split('\n');
            _out = _out.map(line => '\u21d2 ' + line);
            if (!hide) write(_out.join('\n'));
          }
        },

        setLineTransformer: function(f) {
          transformLine = f;
        },

        require: requireLike(path.dirname(inputFile))
      });

      if (name) contexts[name] = context;
      return context;
    }

    const source = fs.readFileSync(inputFile, 'utf8');
    const lines = source.split('\n');
    const scriptLines = [];
    let lineOffset = 0;
    let runArgs;
    let inCode = false;

    lines.forEach((line, lineNo) => {
      if (!runArgs) {
        runArgs = /^```javascript\s+(--.*)?/i.test(line) && RegExp.$1;
        if (runArgs) {
          runArgs = minimist(runArgs.split(/\s+/));
          hide = !!runArgs.hide;
          lineOffset = lineNo + 1;
          line = line.replace(/\s.*/, '');
        }
      } else if (runArgs && /^```/.test(line)) {
        const script = scriptLines.join('\n');
        scriptLines.length = 0;
        write('');
        const context = getContext(runArgs.context);
        vm.runInContext(script, context, {
          lineOffset,
          filename: inputFile
        });

        runArgs = false;
        if (hide) line = null;
        hide = false;
      } else if (runArgs) {
        scriptLines.push(line);
      }

      if (!hide && line != null) {
        if (transformLine) line = transformLine(line, !!runArgs);
        if (line != null) write(line);
      }
    });

    if (options && !options.lame) {
      write('----');
      write(this.pathTo ?
        `Page rendered from [${argv._[0]}](${this.pathTo}) by ${LINK}` :
        `Page rendered by ${LINK}`);
    }

    if (this.outputFile) {
      const output = fs.openSync(this.outputFile, 'w');
      fs.writeSync(output, outputLines.join('\n'));
      fs.closeSync(output);
    } else {
      process.stdout.write(outputLines.join('\n'));
    }
  }
}

if (argv._.length != 1) {
  console.log(argv);
  console.warn('Must specify exactly one input file');
  process.exit(1);
}

if (argv.watch && !argv.output) {
  console.warn('--watch option requires --output=[output_file] option');
  process.exit(1);
}

const renderer = new Renderer(argv._[0], argv.output);
let mtime = 0;

function render(...args) {
  const stats = fs.statSync(renderer.inputFile);
  if (stats.mtime > mtime) {
    mtime = stats.mtime;
    renderer.render(argv);
    console.log('Rendered', argv._[0]);
  }
  if (argv.watch) setTimeout(render, 1000);
}

render();

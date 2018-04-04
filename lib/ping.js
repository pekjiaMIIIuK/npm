'use strict'

const BB = require('bluebird')

const crypto = require('crypto')
const fetch = require('npm-registry-fetch')
const log = require('npmlog')
const npm = require('./npm.js')
const output = require('./utils/output.js')
const pudding = require('figgy-pudding')

module.exports = ping

ping.usage = 'npm ping\nping registry'

const npmSession = crypto.randomBytes(8).toString('hex')
const hookConfig = pudding()
function config () {
  return hookConfig({
    refer: npm.refer,
    projectScope: npm.projectScope,
    log,
    npmSession
  }, npm.config)
}

function ping (args, silent, cb) {
  if (typeof cb !== 'function') {
    cb = silent
    silent = false
  }
  return BB.try(() => {
    return fetch('/-/ping?write=true', config())
      .then(res => res.json().catch(() => ({})))
      .then(json => {
        if (silent) {
        } else if (npm.config.get('json')) {
          output(JSON.stringify(json, null, 2))
        } else if (!Object.keys(json).length) {
          output('Ping success')
        } else {
          output(`Ping success:\n${JSON.stringify(json, null, 2)}`)
        }
      })
  }).nodeify(cb)
}

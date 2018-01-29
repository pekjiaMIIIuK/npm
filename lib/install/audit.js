'use strict'
exports.generate = generate
exports.generateFromInstall = generateFromInstall
exports.submit = submit
exports.printInstallReport = printInstallReport
exports.printFullReport = printFullReport

const Bluebird = require('bluebird')
const fs = require('graceful-fs')
const readFile = Bluebird.promisify(fs.readFile)
const auditReport = require('npm-audit-report')
const treeToShrinkwrap = require('../shrinkwrap.js').treeToShrinkwrap
const packageId = require('../utils/package-id.js')
const output = require('../utils/output.js')
const npm = require('../npm.js')
const path = require('path')
const spawn = require('child_process').spawn
const qw = require('qw')
const registryFetch = require('npm-registry-fetch')
const fetch = require('make-fetch-happen')

function submit (auditData) {
  return fetch('https://security-microservice-1-west.npm.red/v1/audits/', {
    "method": "POST",
    "headers": { "Content-Type": "application/json" },
    "body": JSON.stringify(auditData)
  }).then(r => {
    return r.json()
  })
/*
REAL
  return registryFetch('/-/v1/audits/', {
    "method": "POST",
    "body": authData,
  }).json()
*/
/*
ENTIRELY FAKE:
  return Promise.resolve({
      "actions": [],
      "advisories": {},
      "muted": [],
      "metadata":{
        "dependencies": 375,
        "devDependencies": 466,
        "optionalDependencies": 77,
        "totalDependencies": 918
      }
    })
*/
}

function printInstallReport (auditResult) {
  return auditReport(auditResult, {
    reporter: 'install',
    withColor: npm.color,
    withUnicode: npm.config.get('unicode')
  }).then(result => output(result.report))
}

function printFullReport (auditResult) {
  return auditReport(auditResult, {
    log: output,
    reporter: 'detail',
    withColor: npm.color,
    withUnicode: npm.config.get('unicode')
  }).then(result => output(result.report))
}

function generate (shrinkwrap, requires, diffs, install, remove) {
  const sw = Object.assign({}, shrinkwrap)
  delete sw.lockfileVersion
//  sw.auditReportVersion = '1.0'
  sw.requires = requires


  sw.diffs = diffs || {}
  sw.install = install || []
  sw.remove = remove || []

  return generateMetadata().then((md) => {
    sw.metadata = md
    return sw
  })
}

function generateMetadata() {
  const meta = {}
  meta.npm_version = npm.version
  meta.node_version = process.version
  meta.platform = process.platform

  const head = path.resolve(npm.prefix, '.git/HEAD')
  return readFile(head, 'utf8').then((head) => {
    if (!head.match(/^ref: /)) {
      meta.commit_hash = head.trim()
      return
    }
    const headFile = head.replace(/^ref: /, '').trim()
    meta.branch = headFile.replace(/^refs[/]heads[/]/, '')
    return readFile(path.resolve(npm.prefix, '.git', headFile), 'utf8')
  }).then((commitHash) => {
    meta.commit_hash = commitHash.trim()
    const proc = spawn('git', qw`diff --quiet --exit-code package.json package-lock.json`, {cwd: npm.prefix, stdio: 'ignore'})
    return new Promise((resolve) => {
      proc.once('error', reject)
      proc.on('exit', (code, signal) => {
        if (signal == null) meta.state = code === 0 ? 'clean' : 'dirty'
        resolve()
      })
    })
  }).then(() => meta, () => meta)
}

function generateFromInstall (tree, diffs, install, remove) {
  const requires = {}
  tree.requires.forEach((pkg) => {
    requires[pkg.package.name] = tree.package.dependencies[pkg.package.name] || tree.package.devDependencies[pkg.package.name] || pkg.package.version
  })

  const auditInstall = (install || []).filter((a) => a.name).map(packageId)
  const auditRemove = (remove || []).filter((a) => a.name).map(packageId)
  const auditDiffs = {}
  diffs.forEach((action) => {
    const mutation = action[0]
    const child = action[1]
    if (mutation !== 'add' && mutation !== 'update' && mutation !== 'remove') return
    if (!auditDiffs[mutation]) auditDiffs[mutation] = []
    if (mutation === 'add') {
      auditDiffs[mutation].push({location: child.location})
    } else if (mutation === 'update') {
      auditDiffs[mutation].push({location: child.location, previous: packageId(child.oldPkg)})
    } else if (mutation === 'remove') {
      auditDiffs[mutation].push({previous: packageId(child)})
    }
  })

  return generate(treeToShrinkwrap(tree), requires, auditDiffs, auditInstall, auditRemove)
}

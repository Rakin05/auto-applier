#!/usr/bin/env node

const pug = require('pug');
const fs = require('fs')
const Rx = require('rx');
const program = require('commander');
const request = require('request-promise');
const cheerio = require('cheerio')
const wkhtmltopdf = require('wkhtmltopdf');
const nodemailer = require("nodemailer");
const merge = require('merge');
const sleep = require('sleep');
const _ = require('lodash')

program
  .option('-f, --file <path>', 'File with appliances from XING')
  .option('-c, --config <path>', 'File with configurations')
  .parse(process.argv);

const templateFolder = `${__dirname}/templates/`;
const applianceTemplateFile = `${templateFolder}/appliance.pug`;

const outputFolder = `${__dirname}/output`;

const attachmentsFolder = `${__dirname}/attachments`

const config = JSON.parse(fs.readFileSync(program.config));

const smtpTransport = nodemailer.createTransport(`smtps://${config.emailConfig.username}%40gmail.com:${config.emailConfig.password}@smtp.gmail.com`);

const file = fs.readFileSync(program.file);
const fileJson = JSON.parse(file);
const jobs = fileJson.jobs.items.filter( job => job.location.city === 'Dresden')
const templateData = Rx.Observable.from(jobs)
  .map(extractRelevantData)
  .filter(job => job.jobDescription.indexOf('Senior') === -1)
  .filter(job => job.jobDescription.indexOf('Student') === -1)
  .filter(job => job.jobDescription.indexOf('Praktikum') === -1)
  .filter(job => job.jobDescription !== undefined)
  .filter(job => job.xingAddress !== undefined)
  .map(getSite)
  .concatAll()
  .map(extractEmail)
  .map(extractStreet)
  .filter(job => job.email !== '')
  .map(createApplianceTemplate.bind(undefined, applianceTemplateFile))
  .map(createAppliancePDF.bind(undefined, outputFolder))
  .subscribe(sendEmail.bind(undefined, outputFolder, attachmentsFolder));

function createApplianceTemplate(applianceTemplate, job){
  const userData = {
    name: config.name,
    address: config.address,
    city: config.city,
    userEmail: config.email,
    mobile: config.mobile
  };
  job.appliance = pug.renderFile(applianceTemplate, merge(userData, job));
  return job
}

function extractRelevantData(job){
  return {
    companyName: job.company.name,
    companyAddress: job.location.street,
    companyCity: job.location.zip_code + ' ' + job.location.city,
    jobDescription: job.title,
    xingAddress: job.company.links.xing
  }
}

function getSite(job){
  const siteRequest = Rx.Observable.fromPromise(request(job.xingAddress))
  return siteRequest.map( site => {
    job.site = site;
    return job;
  });
}

function extractEmail(job){
  const $ = cheerio.load(job.site);
  const email = $('a[itemprop="email"]').text();
  job.email = email;
  return job;
}

function extractStreet(job){
  const $ = cheerio.load(job.site);
  const address = $('div[itemprop="streetAddress"]').text();
  job.companyAddress = address;
  return job;
}

function createAppliancePDF(outputFolder, job){
  const fileName = `${outputFolder}/Anschreiben_${job.companyName.replace(' ', '-').replace('.', '')}.pdf`
  wkhtmltopdf(job.appliance, {output: fileName})
  job.applianceFile = fileName;
  return job;
}

function sendEmail(outputFolder, attachmentsFolder, job){
  const emailOptions = {
      from: `${config.email}`,
      to: `${job.email}`,
      subject: `Bewerbung ${job.jobDescription}`,
      text: `Sehr geehrte Damen und Herren, \n\nBitte entnehmen Sie dem Anhang meine Bewerbung für ihre Stellenanzeige "${job.jobDescription}" bei www.xing.com\n\n\nIch verbleibe mit einem freundlichen Gruß und freue mich von ihnen zu höhren.\n\n`,
      attachments: [
        {
            path: job.applianceFile
        }
      ]
    };
  config.attachments.forEach(a => {
    emailOptions.attachments = [...emailOptions.attachments, {path: a.path}]
  })
  smtpTransport.sendMail(emailOptions,function(err, result){
        if(err){
          console.log(err);
        }
        else { console.log(result);}
  });
}

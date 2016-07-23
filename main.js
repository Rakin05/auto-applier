#!/usr/bin/env node

const pug = require('pug');
const fs = require('fs')
const Rx = require('rx');
const program = require('commander');
const request = require('request-promise');
const cheerio = require('cheerio')
const wkhtmltopdf = require('wkhtmltopdf');
const emailjs = require('emailjs');
const merge = require('merge');

program
  .option('-f, --file <path>', 'File with appliances from XING')
  .option('-c, --config <path>', 'File with configurations')
  .parse(process.argv);

const templateFolder = `${__dirname}/templates/`;
const applianceTemplateFile = `${templateFolder}/appliance.pug`;

const outputFolder = `${__dirname}/output`;

const attachmentsFolder = `${__dirname}/attachments`

const config = JSON.parse(fs.readFileSync(program.config));

const emailServer = emailjs.server.connect({
  user: config.emailConfig.username,
  password: config.emailConfig.password,
  host: config.emailConfig.host,
  ssl: true,
  port : 465
});

const file = fs.readFileSync(program.file);
const fileJson = JSON.parse(file);
const jobs = fileJson.jobs.items.filter( job => job.location.city === 'Dresden')
const templateData = Rx.Observable.from(jobs)
  .map(extractRelevantData)
  .filter(job => job.jobDescription.indexOf('Senior') === -1)
  .filter(job => job.jobDescription.indexOf('Student') === -1)
  .filter(job => job.jobDescription.indexOf('Praktikum') === -1)
  .filter(job => job.xingAddress !== undefined)
  .map(getSite)
  .concatAll()
  .map(extractEmail)
  .map(extractStreet)
  .filter(job => job.email !== '')
  .map(createApplianceTemplate.bind(undefined, applianceTemplateFile))
  .map(createAppliancePDF.bind(undefined, outputFolder))
  .take(1)
  .subscribe(sendEmail.bind(undefined, emailServer, outputFolder, attachmentsFolder));

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
  const fileName = `${outputFolder}/Anschreiben_${job.companyName}.pdf`
  wkhtmltopdf(job.appliance, {output: fileName})
  job.applianceFile = fileName;
  return job;
}

function sendEmail(emailServer, outputFolder, attachmentsFolder, job){
  const message = emailjs.message.create({
    text: `Sehr geehrte Damen und Herren, \n\n
    Bitte entnehmen Sie dem Anhang meine Bewerbung für ihre Stellenanzeige "${job.jobDescription} bei www.xing.com\n\n\n
    Ich verbleibe mit einem freundlichen Gruß und freue mich von ihnen zu höhren.\n\n
    ${config.name}`,
    from: `${config.name} <${config.email}>`,
    to: `${config.email}`,
    subject: `Bewerbung ${job.jobDescription}`
  });
  console.log(message);
  message.attach(job.applianceFile, 'application/pdf', 'Anschreiben.pdf');
  config.attachments.forEach(attachment => {
     message.attach(attachment.path, attachment.type, attachment.name);
  })
  emailServer.send(message, function(err){
    if(err !== undefined){
      console.log(err);
    }
  });
}

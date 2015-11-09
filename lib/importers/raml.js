var parser = require('raml-parser'),
    Endpoint = require('../entities/endpoint'),
    Group = require('../entities/group'),
    Importer = require('./importer'),
    Project = require('../entities/project'),
    url = require('url')

//TODO multi file support isn't justified

function RAML() {
  this.schemas = []
}
RAML.prototype = new Importer()

function mapBody(methodBody) {
  var data = {mimeType: '', body: {}, example: ''}

  for (var mimeType in methodBody) {
    data.mimeType = mimeType

    if (!methodBody[mimeType]) {
      continue
    }

    if (methodBody[mimeType].example) {
      data.example = methodBody[mimeType].example
    }

    if (!methodBody[mimeType].schema) {
      continue
    }

    var definition = JSON.parse(methodBody[mimeType].schema)
    delete definition['$schema']

    if (definition['type'] && definition['type'] === 'object') {
      data.body['properties'] = {}
    }
    var requiredFileds = []
    for (var key in definition) {
      if (typeof definition[key] === 'object') {
        for (var property in definition[key]) {
          data.body.properties[property] = definition[key][property]
          if (definition[key][property].required) {
            requiredFileds.push(property)
          }
          delete definition[key][property].required
        }
      }
      else {
        if (key !== 'required') {
          data.body[key] = definition[key]
        }
        else if (definition[key] === true) {
          requiredFileds.push(key)
        }
      }
    }
    data.body.required = requiredFileds
  }

  return data
}

function mapQueryStringOrHeader(queryParameters) {
  var queryString = {type:'object', properties: {}, required: []}
  for (var key in queryParameters) {
    queryString.properties[key] = queryParameters[key]
    if (queryParameters[key].required) {
      queryString.required.push(key)
    }
  }
  return queryString
}

function mapURIParams(uriParams) {
  var pathParams = uriParams
  for (var key in pathParams) {
    pathParams[key].description = pathParams[key].displayName
    delete pathParams[key].displayName
    delete pathParams[key].type
    delete pathParams[key].required
  }
  return pathParams
}

function mapResponse(response) {
  var data = []
  for(var code in response) {
    if (!response[code] || !response[code].body) {
      continue
    }
    var result = mapBody(response[code].body)
    result.codes = [code]
    result.body = JSON.stringify(result.body)
    data.push(result)
  }
  return data
}

function mapSchema(schemData) {
  var schemas = []
   for (var i in schemData) {
    for (var schemaName in schemData[i]) {
      var sd = new Schema(schemaName)
      sd.Definition = schemData[i][schemaName]
      schemas.push(sd)
    }
  }
  return schemas
}


RAML.prototype.createEndpoint = function(me, resource, baseURI) {

  var pathParams = {}
  if(resource.uriParameters) {
    pathParams = mapURIParams(resource.uriParameters)
  }

  for (var i = 0; i < resource.methods.length; i++) {
    var method = resource.methods[i]

    var name
    if (method.displayName || resource.displayName) {
      name = method.displayName || (resource.displayName + '-' + method.method)
    }

    var endpoint = new Endpoint(name)
    endpoint.Method = method.method
    endpoint.Path = baseURI + resource.relativeUri
    endpoint.Description = method.description

    if (method.body) {
      endpoint.Body = mapBody(method.body)
    }

    if (method.queryParameters) {
      endpoint.QueryString = mapQueryStringOrHeader(method.queryParameters)
    }

    if (method.headers) {
      endpoint.Headers = mapQueryStringOrHeader(method.headers)
    }

    if (method.responses) {
      endpoint.Responses = mapResponse(method.responses)
    }

    endpoint.PathParams = pathParams

    me.project.addEndpoint(endpoint)
  }

  if(resource.resources && resource.resources.length > 0) {
    for (var i = 0; i < resource.resources.length; i++) {
      me.createEndpoint(me, resource.resources[i], baseURI + resource.relativeUri)
    }
  }
}

RAML.prototype.loadFile = function (filePath, cb) {
  var me = this

  parser.loadFile(filePath).then(function(data) {
    me.data = data
    cb()
  }, function(error) {
    console.log('Error parsing: ' + error)
    cb()
  })
}

RAML.prototype._import = function() {
  this.project = new Project(this.data.title)

  //TODO set project description from documentation
  //How to know which documentation describes the project briefly?

  var parsedURL = url.parse(this.data.baseUri || 'http://localhost:3000')
  this.project.Environment.Host = parsedURL.protocol + '//' + parsedURL.host
  this.project.Environment.BasePath = parsedURL.path || ''
  this.project.Environment.Protocols = this.data.protocols
  this.project.Environment.DefaultResponseType = this.data.mediaType || ''
  this.project.Environment.DefaultRequestType = this.data.mediaType || ''
  this.project.Environment.Version = this.data.version

  for (var i = 0; i < this.data.resources.length; i++) {
    this.createEndpoint(this, this.data.resources[i], '')
  }

  this.schemas = mapSchema(this.data.schemas)
  for(var i in this.schemas) {
    this.project.addSchema(this.schemas[i])
  }
}

module.exports = RAML
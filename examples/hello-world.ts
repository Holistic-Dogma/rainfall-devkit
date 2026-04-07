// hello world


export default ({ rainfall }: { rainfall: any }) => {
  return {
    name: "hello-world",
    description: "hello world",
    schema: {
      type: "object",
      properties: {
        hellotarget: {
          type: "string",
          
        }
      },
      required: []
    },
    async execute(args:any) {
      console.log(`executing. ${JSON.stringify(args)}`)
      return {
        message: `hello ${ args?.hellotarget || 'you'}`
      }
    }
  };
};
